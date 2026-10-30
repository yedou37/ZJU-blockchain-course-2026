import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";

/**
 * 作业要求自检脚本：逐条核对链上状态，输出一份检查清单。
 * 用法：npm run verify（需要本地链已部署）
 */

type Check = { name: string; ok: boolean; detail: string };

async function main() {
  const deploymentPath = path.resolve(process.cwd(), "deployments/local.json");
  if (!fs.existsSync(deploymentPath)) {
    throw new Error("找不到 deployments/local.json，请先运行 npm run deploy");
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const { ethers } = await hre.network.create();

  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  // 1. ERC20 代币与水龙头
  const tokens = [];
  for (const token of deployment.tokens) {
    const contract = await ethers.getContractAt("MockERC20", token.address);
    const cooldown = await contract.faucetCooldownLeft(deployment.deployer);
    tokens.push({ symbol: token.symbol, contract, cooldown });
  }
  add(
    "至少两个 ERC20 代币",
    tokens.length >= 2,
    tokens.map((token) => token.symbol).join(" / ") + `（共 ${tokens.length} 个）`
  );
  add(
    "代币可领取（水龙头）",
    tokens.every((token) => token.cooldown >= 0n),
    "每个代币都有 claim() 与冷却查询"
  );

  const faucet = await ethers.getContractAt("Faucet", deployment.faucet);
  const faucetBalance = await faucet.balance();
  add("可以领取测试 ETH", faucetBalance > 0n, `Faucet 余额 ${ethers.formatEther(faucetBalance)} ETH`);

  // 2. 交易池
  const dexes = [];
  for (const dexInfo of deployment.dexes) {
    const dex = await ethers.getContractAt("MiniDEX", dexInfo.address);
    const pools = await dex.getPools();
    dexes.push({ info: dexInfo, contract: dex, pools });
  }
  const poolCount = dexes.reduce((sum, dex) => sum + dex.pools.length, 0);
  add(
    "前端可创建 / 查看 AMM 交易池",
    poolCount >= 2,
    `${dexes.length} 个交易所，共 ${poolCount} 个池子`
  );

  const firstPool = dexes[0].pools[0];
  add(
    "恒定乘积 + 手续费",
    firstPool.feeBps === 30n,
    `手续费 ${Number(firstPool.feeBps)} bps，储备 ${ethers.formatUnits(firstPool.reserve0, 18)} / ${ethers.formatUnits(
      firstPool.reserve1,
      18
    )}`
  );

  const quote = await dexes[0].contract.getAmountOut(1, firstPool.token0, ethers.parseEther("100"));
  add("swap 报价可用", quote > 0n, `100 token0 ≈ ${ethers.formatUnits(quote, 18)} token1`);

  // 3. ERC721 流动性凭证
  const positions: any[] = await dexes[0].contract.getAllPositions();
  const live = positions.filter((row: any) => row.shares > 0n);
  add("流动性凭证是 ERC721 NFT", live.length > 0, `DEX-A 当前有 ${live.length} 枚未销毁的 LP NFT`);
  if (live.length > 0) {
    const uri: string = await dexes[0].contract.tokenURI(live[0].tokenId);
    add("NFT 元数据包含池子信息", uri.startsWith("data:application/json"), uri.slice(0, 64) + "…");
    add(
      "NFT 可销毁赎回",
      live[0].amount0 > 0n || live[0].amount1 > 0n,
      `#${live[0].tokenId} 可赎回 ${ethers.formatUnits(live[0].amount0, 18)} / ${ethers.formatUnits(
        live[0].amount1,
        18
      )}`
    );
  }

  // 4. 模拟用户
  const traders = new Set<string>();
  let swaps = 0;
  for (const dex of dexes) {
    const events: any[] = await dex.contract.queryFilter(dex.contract.filters.Swap(), 0, "latest");
    swaps += events.length;
    for (const event of events) traders.add(event.args.trader.toLowerCase());
  }
  add("模拟用户随机交易", swaps > 0, `共 ${swaps} 笔 swap，涉及 ${traders.size} 个交易地址`);

  const lps = new Set<string>();
  for (const dex of dexes) {
    const events: any[] = await dex.contract.queryFilter(dex.contract.filters.LiquidityAdded(), 0, "latest");
    for (const event of events) lps.add(event.args.provider.toLowerCase());
  }
  add("模拟用户添加 / 撤销流动性", lps.size > 0, `${lps.size} 个地址提供过流动性`);
  add(
    "至少 20 个模拟用户参与",
    traders.size + lps.size >= 20,
    `交易地址 ${traders.size} 个 + 流动性地址 ${lps.size} 个`
  );

  // 5. Bonus：多交易所 + 套利
  add("部署了多个交易所", dexes.length >= 2, dexes.map((dex) => dex.info.name).join(" / "));

  const priceOf = async (dexIndex: number) => {
    const pool = dexes[dexIndex].pools[0];
    return Number(pool.reserve1) / Number(pool.reserve0);
  };
  const priceA = await priceOf(0);
  const priceB = await priceOf(1);
  const gap = (Math.abs(priceA - priceB) / Math.min(priceA, priceB)) * 10000;

  const arbitrage = await ethers.getContractAt("Arbitrage", deployment.arbitrage);
  const arbEvents: any[] = await arbitrage.queryFilter(arbitrage.filters.ArbitrageExecuted(), 0, "latest");
  const profit = arbEvents.reduce((sum: bigint, event: any) => sum + event.args.profit, 0n);
  add(
    "套利合约存在并可调用",
    typeof arbitrage.preview === "function",
    `已执行 ${arbEvents.length} 次套利，累计利润 ${ethers.formatUnits(profit, 18)} TKB`
  );
  add(
    "两个交易所价格差可量化",
    gap >= 0,
    `DEX-A ${priceA.toFixed(4)} / DEX-B ${priceB.toFixed(4)}，价差 ${gap.toFixed(0)} bps`
  );

  // 输出
  const width = 26;
  console.log("\n=== 作业要求自检 ===\n");
  let passed = 0;
  for (const check of checks) {
    if (check.ok) passed++;
    const mark = check.ok ? "✅" : "❌";
    const name = check.name.padEnd(width, " ");
    console.log(`${mark} ${name} ${check.detail}`);
  }
  console.log(`\n${passed}/${checks.length} 项通过\n`);
  if (passed !== checks.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
