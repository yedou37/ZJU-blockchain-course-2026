import { expect } from "chai";
import hre from "hardhat";

const { ethers, networkHelpers } = await hre.network.create();

const UNIT = 10n ** 18n;
const units = (n: string | number) => ethers.parseUnits(String(n), 18);

describe("MockERC20 水龙头", function () {
  it("可以领取测试代币，冷却期内不能重复领取", async function () {
    const [owner, alice] = await ethers.getSigners();
    const token = await ethers.deployContract("MockERC20", ["Token A", "TKA", 18, units(1_000_000)]);
    await token.waitForDeployment();

    expect(await token.balanceOf(owner.address)).to.equal(units(1_000_000));
    expect(await token.balanceOf(alice.address)).to.equal(0n);

    await token.connect(alice).claim();
    expect(await token.balanceOf(alice.address)).to.equal(units(1000));
    expect(await token.faucetCooldownLeft(alice.address)).to.be.greaterThan(0n);

    await expect(token.connect(alice).claim()).to.be.revertedWith("MockERC20: faucet is cooling down");
  });
});

describe("MiniDEX", function () {
  async function deployFixture() {
    const [owner, alice, bob] = await ethers.getSigners();

    const tokenA = await ethers.deployContract("MockERC20", ["Token A", "TKA", 18, units(1_000_000)]);
    const tokenB = await ethers.deployContract("MockERC20", ["Token B", "TKB", 18, units(1_000_000)]);
    const dex = await ethers.deployContract("MiniDEX", ["MiniDEX-Test"]);
    await Promise.all([tokenA.waitForDeployment(), tokenB.waitForDeployment(), dex.waitForDeployment()]);

    // 给测试用户发一些代币
    for (const user of [alice, bob]) {
      await tokenA.transfer(user.address, units(100_000));
      await tokenB.transfer(user.address, units(100_000));
    }

    const dexA = dex.connect(owner);
    await dexA.createPool(await tokenA.getAddress(), await tokenB.getAddress());

    return { owner, alice, bob, tokenA, tokenB, dex };
  }

  it("创建交易池：poolId 从 1 开始，重复交易对会被拒绝", async function () {
    const { tokenA, tokenB, dex } = await networkHelpers.loadFixture(deployFixture);
    expect(await dex.poolCount()).to.equal(1n);

    const pool = await dex.getPool(1);
    expect(pool.poolId).to.equal(1n);
    expect(pool.feeBps).to.equal(30n);
    expect(pool.totalShares).to.equal(0n);

    await expect(
      dex.createPool(await tokenB.getAddress(), await tokenA.getAddress())
    ).to.be.revertedWith("MiniDEX: pool already exists");
  });

  it("首次添加流动性：份额 = sqrt(amount0 * amount1)，并铸造 ERC721 NFT", async function () {
    const { alice, tokenA, tokenB, dex } = await networkHelpers.loadFixture(deployFixture);
    const dexA = dex.connect(alice);
    await tokenA.connect(alice).approve(await dex.getAddress(), units(10_000));
    await tokenB.connect(alice).approve(await dex.getAddress(), units(10_000));

    await expect(dexA.addLiquidity(1, units(1000), units(1000), 0, 0))
      .to.emit(dex, "LiquidityAdded")
      .withArgs(1, 1, alice.address, units(1000), units(1000), units(1000));

    const position = await dex.positions(1);
    expect(position.poolId).to.equal(1n);
    expect(position.shares).to.equal(units(1000));
    expect(await dex.ownerOf(1)).to.equal(alice.address);

    const pool = await dex.getPool(1);
    expect(pool.reserve0).to.equal(units(1000));
    expect(pool.reserve1).to.equal(units(1000));

    const ids = await dex.tokenIdsOf(alice.address);
    expect(ids.length).to.equal(1);
    expect(ids[0]).to.equal(1n);
  });

  it("后续添加流动性按比例配比，份额按储备占比计算", async function () {
    const { alice, bob, tokenA, tokenB, dex } = await networkHelpers.loadFixture(deployFixture);
    await tokenA.connect(alice).approve(await dex.getAddress(), units(10_000));
    await tokenB.connect(alice).approve(await dex.getAddress(), units(10_000));
    await dex.connect(alice).addLiquidity(1, units(1000), units(1000), 0, 0);

    await tokenA.connect(bob).approve(await dex.getAddress(), units(10_000));
    await tokenB.connect(bob).approve(await dex.getAddress(), units(10_000));
    // 期望 500/500，但只给 500/400 => 实际按 400/400 注入
    const tx = dex.connect(bob).addLiquidity(1, units(500), units(400), 0, 0);
    await expect(tx).to.emit(dex, "LiquidityAdded");

    const position = await dex.positions(2);
    expect(position.amount0AtMint).to.equal(units(400));
    expect(position.amount1AtMint).to.equal(units(400));
    expect(position.shares).to.equal(units(400));

    const pool = await dex.getPool(1);
    expect(pool.totalShares).to.equal(units(1400));
  });

  it("swap：恒定乘积 + 0.3% 手续费，k 值只会变大", async function () {
    const { alice, bob, tokenA, tokenB, dex } = await networkHelpers.loadFixture(deployFixture);
    await tokenA.connect(alice).approve(await dex.getAddress(), units(10_000));
    await tokenB.connect(alice).approve(await dex.getAddress(), units(10_000));
    await dex.connect(alice).addLiquidity(1, units(10_000), units(10_000), 0, 0);

    // 池子里的 token0 由地址大小决定，这里按实际顺序取
    const poolBefore = await dex.getPool(1);
    const tokenIn = poolBefore.token0;
    const tokenInContract = tokenIn === (await tokenA.getAddress()) ? tokenA : tokenB;
    const tokenOutContract = tokenIn === (await tokenA.getAddress()) ? tokenB : tokenA;

    const amountIn = units(100);
    const quoted = await dex.getAmountOut(1, tokenIn, amountIn);
    // 100 * 0.997 * 10000 / (10000 + 100 * 0.997) ≈ 98.72
    expect(quoted).to.be.closeTo(ethers.parseUnits("98.7157", 18), ethers.parseUnits("0.01", 18));

    const kBefore = poolBefore.reserve0 * poolBefore.reserve1;

    await tokenInContract.connect(bob).approve(await dex.getAddress(), units(10_000));
    const balanceBefore = await tokenOutContract.balanceOf(bob.address);
    await expect(dex.connect(bob).swapExactIn(1, tokenIn, amountIn, quoted, bob.address)).to.emit(dex, "Swap");
    const balanceAfter = await tokenOutContract.balanceOf(bob.address);
    expect(balanceAfter - balanceBefore).to.equal(quoted);

    const after = await dex.getPool(1);
    expect(after.reserve0).to.equal(poolBefore.reserve0 + amountIn);
    expect(after.reserve1).to.equal(poolBefore.reserve1 - quoted);
    expect(after.reserve0 * after.reserve1).to.be.greaterThan(kBefore);
    expect(after.swapCount).to.equal(1n);
  });

  it("swap：滑点保护会 revert", async function () {
    const { alice, bob, tokenA, tokenB, dex } = await networkHelpers.loadFixture(deployFixture);
    await tokenA.connect(alice).approve(await dex.getAddress(), units(10_000));
    await tokenB.connect(alice).approve(await dex.getAddress(), units(10_000));
    await dex.connect(alice).addLiquidity(1, units(10_000), units(10_000), 0, 0);

    await tokenA.connect(bob).approve(await dex.getAddress(), units(10_000));
    await expect(
      dex.connect(bob).swapExactIn(1, await tokenA.getAddress(), units(100), units(200), bob.address)
    ).to.be.revertedWith("MiniDEX: slippage exceeded");
  });

  it("销毁 NFT 撤出流动性：拿回本金并获得手续费分红", async function () {
    const { alice, bob, tokenA, tokenB, dex } = await networkHelpers.loadFixture(deployFixture);
    await tokenA.connect(alice).approve(await dex.getAddress(), units(10_000));
    await tokenB.connect(alice).approve(await dex.getAddress(), units(10_000));
    await dex.connect(alice).addLiquidity(1, units(1000), units(1000), 0, 0);

    // bob 用 token0 交易几次，为池子贡献手续费
    const pool = await dex.getPool(1);
    const token0Address = pool.token0;
    const token0Contract = token0Address === (await tokenA.getAddress()) ? tokenA : tokenB;
    await token0Contract.connect(bob).approve(await dex.getAddress(), units(10_000));
    for (let i = 0; i < 5; i++) {
      await dex.connect(bob).swapExactIn(1, token0Address, units(100), 0, bob.address);
    }

    const [value0, value1] = await dex.getPositionValue(1);
    expect(value0).to.be.greaterThan(units(1000)); // 收进了 token0 手续费
    expect(value1).to.be.lessThan(units(1000)); // 卖出了 token1

    await expect(dex.connect(alice).removeLiquidity(1, 0, 0)).to.emit(dex, "LiquidityRemoved");
    expect(await dex.positionCount()).to.equal(1n);
    await expect(dex.ownerOf(1)).to.be.revertedWithCustomError(dex, "ERC721NonexistentToken");

    const poolAfter = await dex.getPool(1);
    expect(poolAfter.totalShares).to.equal(0n);
  });

  it("非 NFT 持有者不能销毁他人的流动性", async function () {
    const { alice, bob, tokenA, tokenB, dex } = await networkHelpers.loadFixture(deployFixture);
    await tokenA.connect(alice).approve(await dex.getAddress(), units(10_000));
    await tokenB.connect(alice).approve(await dex.getAddress(), units(10_000));
    await dex.connect(alice).addLiquidity(1, units(1000), units(1000), 0, 0);

    await expect(dex.connect(bob).removeLiquidity(1, 0, 0)).to.be.revertedWith("MiniDEX: not position owner");
  });

  it("tokenURI 返回包含池子信息、份额和时间的元数据", async function () {
    const { alice, tokenA, tokenB, dex } = await networkHelpers.loadFixture(deployFixture);
    await tokenA.connect(alice).approve(await dex.getAddress(), units(10_000));
    await tokenB.connect(alice).approve(await dex.getAddress(), units(10_000));
    await dex.connect(alice).addLiquidity(1, units(1000), units(1000), 0, 0);

    const uri = await dex.tokenURI(1);
    expect(uri.startsWith("data:application/json;utf8,")).to.equal(true);
    expect(uri).to.contain('"poolId"');
    expect(uri).to.contain("TKA");
    expect(uri).to.contain("createdAt");
  });
});
