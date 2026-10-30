import { expect } from "chai";
import hre from "hardhat";

const { ethers, networkHelpers } = await hre.network.create();

const units = (n: string | number) => ethers.parseUnits(String(n), 18);

describe("Arbitrage 原子套利", function () {
  async function deployFixture() {
    const [owner, alice, arbitrageur] = await ethers.getSigners();

    const tokenA = await ethers.deployContract("MockERC20", ["Token A", "TKA", 18, units(1_000_000)]);
    const tokenB = await ethers.deployContract("MockERC20", ["Token B", "TKB", 18, units(1_000_000)]);
    const dex1 = await ethers.deployContract("MiniDEX", ["MiniDEX-A"]);
    const dex2 = await ethers.deployContract("MiniDEX", ["MiniDEX-B"]);
    const arbitrage = await ethers.deployContract("Arbitrage");
    await Promise.all([
      tokenA.waitForDeployment(),
      tokenB.waitForDeployment(),
      dex1.waitForDeployment(),
      dex2.waitForDeployment(),
      arbitrage.waitForDeployment(),
    ]);

    const tokenAAddress = await tokenA.getAddress();
    const tokenBAddress = await tokenB.getAddress();

    for (const dex of [dex1, dex2]) {
      await dex.createPool(tokenAAddress, tokenBAddress);
      await tokenA.approve(await dex.getAddress(), units(1_000_000));
      await tokenB.approve(await dex.getAddress(), units(1_000_000));
    }

    // DEX1: 10000 / 10000（1:1）
    // DEX2: 10000 / 12000（token1 更多，因此 token0 在 DEX2 更贵）
    await dex1.addLiquidity(1, units(10_000), units(10_000), 0, 0);
    await dex2.addLiquidity(1, units(10_000), units(12_000), 0, 0);

    const pool = await dex1.getPool(1);
    const token0 = pool.token0 as string;
    const token1 = pool.token1 as string;
    const token0Contract = token0 === tokenAAddress ? tokenA : tokenB;
    const token1Contract = token1 === tokenAAddress ? tokenA : tokenB;

    // 套利者持有两种代币，并授权给套利合约
    await token0Contract.transfer(arbitrageur.address, units(10_000));
    await token1Contract.transfer(arbitrageur.address, units(10_000));
    await token0Contract.connect(arbitrageur).approve(await arbitrage.getAddress(), units(10_000));
    await token1Contract.connect(arbitrageur).approve(await arbitrage.getAddress(), units(10_000));

    return {
      owner,
      alice,
      arbitrageur,
      tokenA,
      tokenB,
      token0Contract,
      token1Contract,
      dex1,
      dex2,
      arbitrage,
      token0,
      token1,
    };
  }

  const gapOf = (p1: bigint, p2: bigint) => (p1 > p2 ? p1 - p2 : p2 - p1);

  it("preview 能识别价差并算出利润", async function () {
    const { arbitrage, dex1, dex2, token1 } = await networkHelpers.loadFixture(deployFixture);
    // token0 在 DEX2 更贵：在 DEX1 用 token1 买 token0，再去 DEX2 卖出
    const result = await arbitrage.preview(
      await dex1.getAddress(),
      1,
      await dex2.getAddress(),
      1,
      token1,
      units(500)
    );
    expect(result.tokenOut).to.equal(await (await dex1.getPool(1)).token0);
    expect(result.profit).to.be.greaterThan(0n);
    expect(result.finalAmount).to.be.greaterThan(units(500));
  });

  it("一次交易内完成低买高卖，利润归套利者，价差收敛", async function () {
    const { arbitrageur, token1Contract, dex1, dex2, arbitrage, token1 } = await networkHelpers.loadFixture(
      deployFixture
    );

    const price1Before = await arbitrage.price(await dex1.getAddress(), 1, token1);
    const price2Before = await arbitrage.price(await dex2.getAddress(), 1, token1);

    const balanceBefore = await token1Contract.balanceOf(arbitrageur.address);
    await expect(
      arbitrage
        .connect(arbitrageur)
        .execute(await dex1.getAddress(), 1, await dex2.getAddress(), 1, token1, units(500), 0)
    ).to.emit(arbitrage, "ArbitrageExecuted");

    const balanceAfter = await token1Contract.balanceOf(arbitrageur.address);
    expect(balanceAfter).to.be.greaterThan(balanceBefore); // 净赚 token1

    const price1After = await arbitrage.price(await dex1.getAddress(), 1, token1);
    const price2After = await arbitrage.price(await dex2.getAddress(), 1, token1);
    expect(gapOf(price1After, price2After)).to.be.lessThan(gapOf(price1Before, price2Before));
  });

  it("利润要求过高时整笔交易 revert，储备保持不变", async function () {
    const { arbitrageur, dex1, dex2, arbitrage, token1 } = await networkHelpers.loadFixture(deployFixture);

    const poolBefore = await dex1.getPool(1);
    await expect(
      arbitrage
        .connect(arbitrageur)
        .execute(await dex1.getAddress(), 1, await dex2.getAddress(), 1, token1, units(500), units(10_000))
    ).to.be.revertedWith("Arbitrage: not profitable");

    const poolAfter = await dex1.getPool(1);
    expect(poolAfter.reserve0).to.equal(poolBefore.reserve0);
    expect(poolAfter.reserve1).to.equal(poolBefore.reserve1);
  });

  it("反向套利（高买低卖）会 revert", async function () {
    const { arbitrageur, dex1, dex2, arbitrage, token1 } = await networkHelpers.loadFixture(deployFixture);
    // 在贵的 DEX2 买、在便宜的 DEX1 卖 => 必亏
    await expect(
      arbitrage
        .connect(arbitrageur)
        .execute(await dex2.getAddress(), 1, await dex1.getAddress(), 1, token1, units(500), 0)
    ).to.be.revertedWith("Arbitrage: not profitable");
  });

  it("同一个池子不能自己套自己", async function () {
    const { arbitrageur, dex1, arbitrage, token1 } = await networkHelpers.loadFixture(deployFixture);
    await expect(
      arbitrage
        .connect(arbitrageur)
        .execute(await dex1.getAddress(), 1, await dex1.getAddress(), 1, token1, units(100), 0)
    ).to.be.revertedWith("Arbitrage: identical pool");
  });
});
