import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";

/**
 * 一键部署脚本：
 * 1. 部署 3 个测试代币 + WETH + Faucet
 * 2. 部署两个交易所实例 MiniDEX-A / MiniDEX-B（用于制造价差 + 套利）
 * 3. 部署 Arbitrage 套利合约
 * 4. 建池并注入初始流动性（两个交易所的 TKA/TKB 价格故意不同）
 * 5. 把地址与 ABI 写到 frontend/src/lib/deployments.json，前端无需手填
 */

const TOKENS = [
  { symbol: "TKA", name: "Token A", supply: "1000000" },
  { symbol: "TKB", name: "Token B", supply: "1000000" },
  { symbol: "TKC", name: "Token C", supply: "1000000" },
];

const FAUCET_ETH = "100";

async function main() {
  const { ethers } = await hre.network.create();
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const chain = await ethers.provider.getNetwork();

  console.log(`部署账户: ${deployerAddress}  chainId=${chain.chainId}`);

  // ------------------------------------------------------------------
  // 1. 代币
  // ------------------------------------------------------------------
  const tokens: { symbol: string; name: string; address: string; decimals: number }[] = [];
  const tokenContracts: Record<string, any> = {};

  for (const token of TOKENS) {
    const contract = await ethers.deployContract("MockERC20", [
      token.name,
      token.symbol,
      18,
      ethers.parseUnits(token.supply, 18),
    ]);
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    tokenContracts[token.symbol] = contract;
    tokens.push({ symbol: token.symbol, name: token.name, address, decimals: 18 });
    console.log(`  ${token.symbol} -> ${address}`);
  }

  // ------------------------------------------------------------------
  // 2. WETH + Faucet
  // ------------------------------------------------------------------
  const weth = await ethers.deployContract("MockWETH");
  await weth.waitForDeployment();
  const wethAddress = await weth.getAddress();

  const faucet = await ethers.deployContract("Faucet");
  await faucet.waitForDeployment();
  const faucetAddress = await faucet.getAddress();
  await (await deployer.sendTransaction({ to: faucetAddress, value: ethers.parseEther(FAUCET_ETH) })).wait();

  console.log(`  WETH   -> ${wethAddress}`);
  console.log(`  Faucet -> ${faucetAddress} (注入 ${FAUCET_ETH} ETH)`);

  // 部署者准备一些 WETH 用于注入 ETH 交易对
  await (await weth.deposit({ value: ethers.parseEther("300") })).wait();

  // ------------------------------------------------------------------
  // 3. 两个交易所 + 套利合约
  // ------------------------------------------------------------------
  const dexA = await ethers.deployContract("MiniDEX", ["MiniDEX-A"]);
  const dexB = await ethers.deployContract("MiniDEX", ["MiniDEX-B"]);
  const arbitrage = await ethers.deployContract("Arbitrage");
  await Promise.all([dexA.waitForDeployment(), dexB.waitForDeployment(), arbitrage.waitForDeployment()]);

  const dexAAddress = await dexA.getAddress();
  const dexBAddress = await dexB.getAddress();
  const arbitrageAddress = await arbitrage.getAddress();
  console.log(`  MiniDEX-A  -> ${dexAAddress}`);
  console.log(`  MiniDEX-B  -> ${dexBAddress}`);
  console.log(`  Arbitrage  -> ${arbitrageAddress}`);

  // ------------------------------------------------------------------
  // 4. 建池 + 注入初始流动性
  // ------------------------------------------------------------------
  const tkA = tokens.find((t) => t.symbol === "TKA")!.address;
  const tkB = tokens.find((t) => t.symbol === "TKB")!.address;

  for (const dex of [dexA, dexB]) {
    const dexAddress = await dex.getAddress();
    for (const token of tokens) {
      await (await tokenContracts[token.symbol].approve(dexAddress, ethers.MaxUint256)).wait();
    }
    await (await weth.approve(dexAddress, ethers.MaxUint256)).wait();
  }

  // 两个交易所都创建 TKA/TKB 与 TKA/WETH 池
  for (const dex of [dexA, dexB]) {
    await (await dex.createPool(tkA, tkB)).wait();
    await (await dex.createPool(tkA, wethAddress)).wait();
  }

  const seed = async (dex: any, poolId: number, amount0: string, amount1: string) => {
    const tx = await dex.addLiquidity(
      poolId,
      ethers.parseUnits(amount0, 18),
      ethers.parseUnits(amount1, 18),
      0,
      0
    );
    await tx.wait();
  };

  // DEX-A: 1 TKA = 1 TKB
  await seed(dexA, 1, "100000", "100000");
  // DEX-B: 1 TKA = 0.8 TKB（故意制造 20% 价差，供套利演示）
  await seed(dexB, 1, "100000", "80000");
  // TKA/WETH：1 TKA = 0.001 WETH
  await seed(dexA, 2, "50000", "50");
  await seed(dexB, 2, "50000", "50");

  console.log("  初始流动性已注入（DEX-A 1 TKA = 1 TKB，DEX-B 1 TKA = 0.8 TKB）");

  // ------------------------------------------------------------------
  // 5. 导出给前端
  // ------------------------------------------------------------------
  const symbolOf = (address: string) =>
    address.toLowerCase() === wethAddress.toLowerCase()
      ? "WETH"
      : tokens.find((t) => t.address.toLowerCase() === address.toLowerCase())?.symbol ?? "?";

  const describePools = async (dex: any, label: string) => {
    const count = Number(await dex.poolCount());
    const pools = [];
    for (let poolId = 1; poolId <= count; poolId++) {
      const pool = await dex.getPool(poolId);
      pools.push({
        poolId,
        token0: pool.token0,
        token1: pool.token1,
        symbol0: symbolOf(pool.token0),
        symbol1: symbolOf(pool.token1),
        label: `${symbolOf(pool.token0)}/${symbolOf(pool.token1)}`,
      });
    }
    return { key: label, name: `MiniDEX-${label}`, address: await dex.getAddress(), pools };
  };

  const deployment = {
    chainId: Number(chain.chainId),
    rpcUrl: "http://127.0.0.1:8545",
    deployedAt: new Date().toISOString(),
    deployer: deployerAddress,
    tokens,
    weth: { address: wethAddress, symbol: "WETH", decimals: 18 },
    faucet: faucetAddress,
    dexes: [await describePools(dexA, "A"), await describePools(dexB, "B")],
    arbitrage: arbitrageAddress,
    abis: {
      MiniDEX: JSON.parse(dexA.interface.formatJson()),
      MockERC20: JSON.parse(tokenContracts["TKA"].interface.formatJson()),
      MockWETH: JSON.parse(weth.interface.formatJson()),
      Faucet: JSON.parse(faucet.interface.formatJson()),
      Arbitrage: JSON.parse(arbitrage.interface.formatJson()),
    },
  };

  const outputPath = path.resolve(process.cwd(), "../frontend/src/lib/deployments.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(deployment, null, 2), "utf8");

  const localPath = path.resolve(process.cwd(), "deployments/local.json");
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, JSON.stringify(deployment, null, 2), "utf8");

  console.log(`\n部署完成，地址已写入:\n  ${outputPath}\n  ${localPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
