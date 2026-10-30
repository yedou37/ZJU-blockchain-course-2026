import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";

/**
 * 20 个模拟用户的随机交易模拟：
 * - 每个用户先领测试币 / 测试 ETH
 * - 一部分用户成为流动性提供者（铸造 ERC721 流动性凭证）
 * - 之后随机执行 交易 / 添加流动性 / 撤销流动性
 * - 每轮结束检查两个交易所同一交易对的价差，超过阈值就触发原子套利
 * - 结果输出到 docs/simulation-log.md
 */

const USER_COUNT = 20;
const ROUNDS = Number(process.env.SIM_ROUNDS ?? 100);
const LP_COUNT = 10;
const ARB_THRESHOLD_BPS = 150;
const SEED = Number(process.env.SIM_SEED ?? 20261030);

// 简单的可复现随机数生成器
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T>(list: T[]): T => list[randInt(0, list.length - 1)];

type OpRow = {
  round: number;
  user: string;
  action: string;
  detail: string;
  priceA: number;
  priceB: number;
  gapBps: number;
};

type ArbRow = {
  round: number;
  user: string;
  direction: string;
  amountIn: number;
  profit: number;
  profitBps: number;
  priceBefore: [number, number];
  priceAfter: [number, number];
};

async function main() {
  const deploymentPath = path.resolve(process.cwd(), "deployments/local.json");
  if (!fs.existsSync(deploymentPath)) {
    throw new Error("找不到 deployments/local.json，请先运行 npm run deploy");
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  const { ethers } = await hre.network.create();
  const signers = await ethers.getSigners();
  const users = signers.slice(0, USER_COUNT);
  if (users.length < USER_COUNT) {
    throw new Error(`节点只提供了 ${users.length} 个账户，需要 ${USER_COUNT} 个`);
  }

  const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
  const fmt = (value: bigint, digits = 4) => Number(ethers.formatUnits(value, 18)).toFixed(digits);

  const tokenBySymbol: Record<string, any> = {};
  for (const token of deployment.tokens) {
    tokenBySymbol[token.symbol] = await ethers.getContractAt("MockERC20", token.address);
  }
  const weth = await ethers.getContractAt("MockWETH", deployment.weth.address);
  const faucet = await ethers.getContractAt("Faucet", deployment.faucet);
  const arbitrage = await ethers.getContractAt("Arbitrage", deployment.arbitrage);
  const dexes = [
    await ethers.getContractAt("MiniDEX", deployment.dexes[0].address),
    await ethers.getContractAt("MiniDEX", deployment.dexes[1].address),
  ];
  const dexNames = ["DEX-A", "DEX-B"];
  const TKA = deployment.tokens.find((t: any) => t.symbol === "TKA").address;
  const TKB = deployment.tokens.find((t: any) => t.symbol === "TKB").address;
  const POOL_AB = 1; // TKA/TKB 池
  const POOL_AW = 2; // TKA/WETH 池

  console.log(`\n=== 模拟开始：${USER_COUNT} 个用户，${ROUNDS} 轮，随机种子 ${SEED} ===\n`);

  // ------------------------------------------------------------------
  // 1. 领测试币 / 测试 ETH，并授权
  // ------------------------------------------------------------------
  console.log("步骤 1/4：用户领取测试代币与测试 ETH，并授权交易所 ...");
  for (const user of users) {
    const address = await user.getAddress();
    for (const symbol of ["TKA", "TKB", "TKC"]) {
      // 水龙头有冷却时间，重复运行脚本时忽略冷却报错
      try {
        await (await tokenBySymbol[symbol].connect(user).claim()).wait();
      } catch {
        /* 已经领过了 */
      }
    }
    try {
      await (await faucet.connect(user).claimETH()).wait();
    } catch {
      /* 已经领过了 */
    }
    await (await weth.connect(user).deposit({ value: ethers.parseEther("2") })).wait();
    for (const dex of dexes) {
      const dexAddress = await dex.getAddress();
      for (const symbol of ["TKA", "TKB"]) {
        await (await tokenBySymbol[symbol].connect(user).approve(dexAddress, ethers.MaxUint256)).wait();
      }
      await (await weth.connect(user).approve(dexAddress, ethers.MaxUint256)).wait();
    }
    // 套利合约需要拉取用户的 tokenIn
    for (const symbol of ["TKA", "TKB"]) {
      await (await tokenBySymbol[symbol].connect(user).approve(deployment.arbitrage, ethers.MaxUint256)).wait();
    }
    if ((users.indexOf(user) + 1) % 5 === 0) {
      console.log(`  已完成 ${users.indexOf(user) + 1}/${USER_COUNT} 个用户的准备（${short(address)}）`);
    }
  }

  // ------------------------------------------------------------------
  // 2. 前 5 个用户成为流动性提供者
  // ------------------------------------------------------------------
  console.log("步骤 2/4：10 个流动性提供者注入流动性 ...");
  for (let i = 0; i < LP_COUNT; i++) {
    const user = users[i];
    // 每个用户手里有 1000 TKA / 1000 TKB / 2 WETH，这里按比例注入
    await (await dexes[0].connect(user).addLiquidity(POOL_AB, ethers.parseEther("200"), ethers.parseEther("200"), 0, 0)).wait();
    await (await dexes[1].connect(user).addLiquidity(POOL_AB, ethers.parseEther("200"), ethers.parseEther("160"), 0, 0)).wait();
    await (await dexes[0].connect(user).addLiquidity(POOL_AW, ethers.parseEther("200"), ethers.parseEther("0.2"), 0, 0)).wait();
  }
  console.log("  流动性注入完成");

  // ------------------------------------------------------------------
  // 3. 随机操作
  // ------------------------------------------------------------------
  const priceOf = async (dex: any) => {
    const pool = await dex.getPool(POOL_AB);
    return Number(pool.reserve1) / Number(pool.reserve0); // 1 TKA = ? TKB
  };
  const gapBps = (a: number, b: number) => (Math.abs(a - b) / Math.min(a, b)) * 10000;

  const ops: OpRow[] = [];
  const arbs: ArbRow[] = [];
  let swapCount = 0;
  let addCount = 0;
  let removeCount = 0;
  let failedCount = 0;

  console.log("步骤 3/4：开始随机交易 ...");
  for (let round = 1; round <= ROUNDS; round++) {
    const user = pick(users);
    const address = await user.getAddress();
    const roll = rand();
    let action = "";
    let detail = "";

    try {
      if (roll < 0.7) {
        // 随机交易
        const dexIndex = randInt(0, 1);
        const dex = dexes[dexIndex];
        const useEthPool = rand() < 0.3;
        let tokenIn: string;
        let amountIn: bigint;

        if (useEthPool) {
          if (rand() < 0.5) {
            tokenIn = TKA;
            amountIn = ethers.parseUnits(String(randInt(20, 300)), 18);
          } else {
            tokenIn = deployment.weth.address;
            amountIn = ethers.parseUnits((randInt(1, 30) / 100).toFixed(2), 18);
          }
        } else {
          tokenIn = rand() < 0.5 ? TKA : TKB;
          amountIn = ethers.parseUnits(String(randInt(5, 120)), 18);
        }

        const tokenContract =
          tokenIn === TKA ? tokenBySymbol["TKA"] : tokenIn === TKB ? tokenBySymbol["TKB"] : weth;
        const balance: bigint = await tokenContract.balanceOf(address);
        if (balance < amountIn) {
          throw new Error("余额不足");
        }

        const poolId = useEthPool ? POOL_AW : POOL_AB;
        const quoted: bigint = await dex.getAmountOut(poolId, tokenIn, amountIn);
        await (await dex.connect(user).swapExactIn(poolId, tokenIn, amountIn, 0, address)).wait();
        swapCount++;
        action = "swap";
        detail = `${dexNames[dexIndex]} ${useEthPool ? "TKA/WETH" : "TKA/TKB"} 用 ${fmt(amountIn, 2)} ${
          tokenIn === TKA ? "TKA" : tokenIn === TKB ? "TKB" : "WETH"
        } 换出 ${fmt(quoted, 2)}`;
      } else if (roll < 0.88) {
        // 添加流动性
        const dexIndex = randInt(0, 1);
        const dex = dexes[dexIndex];
        const pool = await dex.getPool(POOL_AB);
        const amount0 = ethers.parseUnits(String(randInt(50, 200)), 18);
        const amount1 = (amount0 * pool.reserve1) / pool.reserve0;
        const bal0: bigint = await tokenBySymbol["TKA"].balanceOf(address);
        const bal1: bigint = await tokenBySymbol["TKB"].balanceOf(address);
        if (bal0 < amount0 || bal1 < amount1) {
          throw new Error("余额不足");
        }
        await (await dex.connect(user).addLiquidity(POOL_AB, amount0, amount1, 0, 0)).wait();
        addCount++;
        action = "addLiquidity";
        detail = `${dexNames[dexIndex]} 添加 ${fmt(amount0, 2)} TKA + ${fmt(amount1, 2)} TKB`;
      } else {
        // 撤销流动性
        const dexIndex = randInt(0, 1);
        const dex = dexes[dexIndex];
        const ids: bigint[] = await dex.tokenIdsOf(address);
        if (ids.length === 0) {
          throw new Error("没有流动性 NFT");
        }
        const tokenId = pick(ids);
        await (await dex.connect(user).removeLiquidity(tokenId, 0, 0)).wait();
        removeCount++;
        action = "removeLiquidity";
        detail = `${dexNames[dexIndex]} 销毁 NFT #${tokenId} 撤出流动性`;
      }
    } catch (error) {
      failedCount++;
      action = "skipped";
      detail = (error as Error).message.split("\n")[0].slice(0, 80);
    }

    const priceA = await priceOf(dexes[0]);
    const priceB = await priceOf(dexes[1]);
    ops.push({ round, user: short(address), action, detail, priceA, priceB, gapBps: gapBps(priceA, priceB) });

    // 价差超过阈值 -> 触发套利
    if (gapBps(priceA, priceB) > ARB_THRESHOLD_BPS && rand() < 0.8) {
      const arbUser = pick(users);
      const arbAddress = await arbUser.getAddress();
      // TKA 便宜的那个交易所买入，贵的那个卖出
      const buyIndex = priceA < priceB ? 0 : 1;
      const sellIndex = 1 - buyIndex;
      const tokenIn = TKB; // 用 TKB 买 TKA
      const balance: bigint = await tokenBySymbol["TKB"].balanceOf(arbAddress);

      // 在链上采样，找出利润最大的投入量
      let best = { amount: 0n, profit: 0n };
      const maxIn = balance < ethers.parseEther("3000") ? balance : ethers.parseEther("3000");
      for (let step = 1; step <= 40; step++) {
        const amount = (maxIn * BigInt(step)) / 40n;
        if (amount === 0n) continue;
        try {
          const preview = await arbitrage.preview(
            await dexes[buyIndex].getAddress(),
            POOL_AB,
            await dexes[sellIndex].getAddress(),
            POOL_AB,
            tokenIn,
            amount
          );
          if (preview.profit > best.profit) {
            best = { amount, profit: preview.profit };
          }
        } catch {
          // 忽略无效采样
        }
      }

      if (best.amount > 0n) {
        const priceBefore: [number, number] = [priceA, priceB];
        try {
          const tx = await arbitrage
            .connect(arbUser)
            .execute(
              await dexes[buyIndex].getAddress(),
              POOL_AB,
              await dexes[sellIndex].getAddress(),
              POOL_AB,
              tokenIn,
              best.amount,
              0
            );
          const receipt = await tx.wait();
          const priceAfterA = await priceOf(dexes[0]);
          const priceAfterB = await priceOf(dexes[1]);
          const profitBps = (Number(best.profit) / Number(best.amount)) * 10000;
          arbs.push({
            round,
            user: short(arbAddress),
            direction: `${dexNames[buyIndex]} 买入 TKA → ${dexNames[sellIndex]} 卖出 TKA`,
            amountIn: Number(ethers.formatUnits(best.amount, 18)),
            profit: Number(ethers.formatUnits(best.profit, 18)),
            profitBps,
            priceBefore,
            priceAfter: [priceAfterA, priceAfterB],
          });
          console.log(
            `  第 ${round} 轮套利：${dexNames[buyIndex]} → ${dexNames[sellIndex]}，投入 ${Number(
              ethers.formatUnits(best.amount, 18)
            ).toFixed(2)} TKB，利润 ${Number(ethers.formatUnits(best.profit, 18)).toFixed(2)} TKB，gas ${receipt?.gasUsed}`
          );
        } catch (error) {
          console.log(`  第 ${round} 轮套利失败（已回滚）：${(error as Error).message.split("\n")[0].slice(0, 60)}`);
        }
      }
    }

    if (round % 5 === 0) {
      console.log(`  第 ${round}/${ROUNDS} 轮：价差 ${gapBps(priceA, priceB).toFixed(0)} bps，累计套利 ${arbs.length} 次`);
    }
  }

  // ------------------------------------------------------------------
  // 4. 汇总并写出报告
  // ------------------------------------------------------------------
  const finalPriceA = await priceOf(dexes[0]);
  const finalPriceB = await priceOf(dexes[1]);
  const totalProfit = arbs.reduce((sum, row) => sum + row.profit, 0);

  const poolRows = [];
  for (let i = 0; i < 2; i++) {
    for (const poolId of [POOL_AB, POOL_AW]) {
      const pool = await dexes[i].getPool(poolId);
      poolRows.push({
        dex: dexNames[i],
        pool: poolId === POOL_AB ? "TKA/TKB" : "TKA/WETH",
        reserve0: fmt(pool.reserve0, 2),
        reserve1: fmt(pool.reserve1, 4),
        shares: fmt(pool.totalShares, 2),
        swaps: Number(pool.swapCount),
        price: (Number(pool.reserve1) / Number(pool.reserve0)).toFixed(4),
      });
    }
  }

  const lines: string[] = [];
  lines.push("# 模拟交易运行日志");
  lines.push("");
  lines.push(`> 由 \`contracts/scripts/simulate.ts\` 自动生成，随机种子 ${SEED}，可直接复现。`);
  lines.push("");
  lines.push("## 运行参数");
  lines.push("");
  lines.push(`- 模拟用户：**${USER_COUNT}** 个（使用本地节点预置的解锁账户）`);
  lines.push(`- 随机轮次：**${ROUNDS}** 轮`);
  lines.push(`- 交易所：**MiniDEX-A / MiniDEX-B**（同一交易对 TKA/TKB、TKA/WETH）`);
  lines.push(`- 套利触发阈值：价差 > **${ARB_THRESHOLD_BPS} bps**`);
  lines.push("");
  lines.push("## 操作统计");
  lines.push("");
  lines.push("| 指标 | 数量 |");
  lines.push("| --- | --- |");
  lines.push(`| 交易（swap） | ${swapCount} |`);
  lines.push(`| 添加流动性 | ${addCount} |`);
  lines.push(`| 撤销流动性（销毁 NFT） | ${removeCount} |`);
  lines.push(`| 余额不足等原因跳过 | ${failedCount} |`);
  lines.push(`| 原子套利次数 | ${arbs.length} |`);
  lines.push(`| 套利总利润 | ${totalProfit.toFixed(2)} TKB |`);
  lines.push("");
  lines.push("## 最终池子状态");
  lines.push("");
  lines.push("| 交易所 | 交易对 | reserve0 | reserve1 | 总份额 | 交易次数 | 价格 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const row of poolRows) {
    lines.push(
      `| ${row.dex} | ${row.pool} | ${row.reserve0} | ${row.reserve1} | ${row.shares} | ${row.swaps} | ${row.price} |`
    );
  }
  lines.push("");
  lines.push(
    `最终 TKA/TKB 价格：DEX-A **${finalPriceA.toFixed(4)}** TKB / DEX-B **${finalPriceB.toFixed(
      4
    )}** TKB，价差 **${gapBps(finalPriceA, finalPriceB).toFixed(0)} bps**`
  );
  lines.push("");
  lines.push("## 套利明细");
  lines.push("");
  if (arbs.length === 0) {
    lines.push("本次运行没有触发套利（价差未超过阈值）。");
  } else {
    lines.push("| 轮次 | 套利者 | 路径 | 投入 (TKB) | 利润 (TKB) | 收益率 | 套利前价格 (A / B) | 套利后价格 (A / B) |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const row of arbs) {
      lines.push(
        `| ${row.round} | ${row.user} | ${row.direction} | ${row.amountIn.toFixed(2)} | ${row.profit.toFixed(
          2
        )} | ${row.profitBps.toFixed(0)} bps | ${row.priceBefore[0].toFixed(4)} / ${row.priceBefore[1].toFixed(
          4
        )} | ${row.priceAfter[0].toFixed(4)} / ${row.priceAfter[1].toFixed(4)} |`
      );
    }
  }
  lines.push("");
  lines.push("## 随机操作流水（节选）");
  lines.push("");
  lines.push("| 轮次 | 用户 | 操作 | 详情 | 价差 (bps) |");
  lines.push("| --- | --- | --- | --- | --- |");
  const sample = [...ops.slice(0, 20), ...ops.slice(-15)];
  for (const row of sample) {
    lines.push(`| ${row.round} | ${row.user} | ${row.action} | ${row.detail} | ${row.gapBps.toFixed(0)} |`);
  }
  lines.push("");
  lines.push(`完整流水共 ${ops.length} 条，可在运行时通过控制台查看。`);

  const outputPath = path.resolve(process.cwd(), "../docs/simulation-log.md");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, lines.join("\n"), "utf8");

  console.log("\n步骤 4/4：模拟结束");
  console.log(
    `  swap ${swapCount} 次，添加流动性 ${addCount} 次，撤销 ${removeCount} 次，套利 ${arbs.length} 次，利润 ${totalProfit.toFixed(2)} TKB`
  );
  console.log(`  报告已写入 ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
