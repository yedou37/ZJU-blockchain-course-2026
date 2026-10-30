import { useCallback, useEffect, useState } from "react";
import { MaxUint256 } from "ethers";
import {
  DEXES,
  arbitrageContract,
  dexContract,
  errorText,
  fmt,
  fmtNum,
  loadPools,
  poolPriceText,
  provider,
  shortAddr,
  tokenContract,
  type PoolInfo,
} from "../lib/chain";
import type { PageProps } from "../lib/types";
import { LineChart, type Series } from "../components/Charts";
import { Badge, Button, Card, Empty, Field, Notice, Stat } from "../components/UI";

type LogRow = { id: number; text: string; kind: "swap" | "skip" };

export default function Simulation({ tick, bump }: PageProps) {
  const [pools, setPools] = useState<PoolInfo[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [stats, setStats] = useState({ swaps: 0, adds: 0, removes: 0, arbs: 0, profit: 0n });
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [rounds, setRounds] = useState("20");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const load = useCallback(async () => {
    const list = await loadPools();
    setPools(list);

    const priceA: number[] = [];
    const priceB: number[] = [];
    let swaps = 0;
    let adds = 0;
    let removes = 0;

    for (let dexIndex = 0; dexIndex < DEXES.length; dexIndex++) {
      const dex = dexContract(dexIndex);
      const allSwaps: any[] = await dex.queryFilter(dex.filters.Swap(), 0, "latest");
      const poolSwaps: any[] = await dex.queryFilter(dex.filters.Swap(1), 0, "latest");
      const addEvents: any[] = await dex.queryFilter(dex.filters.LiquidityAdded(), 0, "latest");
      const removeEvents: any[] = await dex.queryFilter(dex.filters.LiquidityRemoved(), 0, "latest");

      swaps += allSwaps.length;
      adds += addEvents.length;
      removes += removeEvents.length;

      const points = poolSwaps.map((event) => Number(event.args.reserve1) / Number(event.args.reserve0));
      if (dexIndex === 0) priceA.push(...points);
      else priceB.push(...points);
    }

    const arbitrage = arbitrageContract();
    const arbEvents: any[] = await arbitrage.queryFilter(arbitrage.filters.ArbitrageExecuted(), 0, "latest");
    const profit = arbEvents.reduce((sum: bigint, event: any) => sum + event.args.profit, 0n);

    setStats({ swaps, adds, removes, arbs: arbEvents.length, profit });
    setSeries([
      { label: `${DEXES[0].name} 价格`, color: "#2f6bff", points: priceA.slice(-80) },
      { label: `${DEXES[1].name} 价格`, color: "#e8722b", points: priceB.slice(-80) },
    ]);
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load, tick]);

  const pushLog = (text: string, kind: LogRow["kind"] = "swap") => {
    setLogs((prev) => [{ id: Date.now() + Math.random(), text, kind }, ...prev].slice(0, 12));
  };

  const runSimulation = async () => {
    setBusy(true);
    setStatus("模拟运行中…");
    const total = Math.max(1, Math.min(Number(rounds) || 10, 60));
    setProgress({ done: 0, total });
    try {
      const signers = await provider.listAccounts();
      const poolList = await loadPools();
      for (let round = 1; round <= total; round++) {
        const signer = signers[Math.floor(Math.random() * signers.length)];
        const address = await signer.getAddress();
        const pool = poolList[Math.floor(Math.random() * poolList.length)];
        const forward = Math.random() < 0.5;
        const tokenIn = forward ? pool.token0 : pool.token1;
        const symbolIn = forward ? pool.symbol0 : pool.symbol1;
        const symbolOut = forward ? pool.symbol1 : pool.symbol0;

        const scale = symbolIn === "WETH" ? 0.05 : 60;
        const amount = BigInt(Math.floor((Math.random() * scale + scale / 4) * 1e6)) * 10n ** 12n;

        try {
          const dex = dexContract(pool.dexIndex, signer);
          const contract = tokenContract(tokenIn, signer);
          const allowance: bigint = await contract.allowance(address, DEXES[pool.dexIndex].address);
          if (allowance < amount) {
            await (await contract.approve(DEXES[pool.dexIndex].address, MaxUint256)).wait();
          }
          const quoted: bigint = await dex.getAmountOut(pool.poolId, tokenIn, amount);
          const tx = await dex.swapExactIn(pool.poolId, tokenIn, amount, 0, address);
          await tx.wait();
          pushLog(
            `第 ${round} 轮 · ${shortAddr(address)} 在 ${pool.dexName} 用 ${fmt(amount, 3)} ${symbolIn} 换出 ${fmt(
              quoted,
              3
            )} ${symbolOut}`,
            "swap"
          );
        } catch (error) {
          pushLog(`第 ${round} 轮 · ${shortAddr(address)} 跳过：${errorText(error)}`, "skip");
        }
        setProgress({ done: round, total });
      }
      setStatus(`模拟完成：共 ${total} 轮随机交易`);
      bump();
      await load();
    } catch (error) {
      setStatus(`模拟失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const poolA = pools.find((pool) => pool.dexIndex === 0 && pool.poolId === 1);
  const poolB = pools.find((pool) => pool.dexIndex === 1 && pool.poolId === 1);
  const gap =
    poolA && poolB && Number(poolA.reserve0) > 0 && Number(poolB.reserve0) > 0
      ? (() => {
          const a = Number(poolA.reserve1) / Number(poolA.reserve0);
          const b = Number(poolB.reserve1) / Number(poolB.reserve0);
          return (Math.abs(a - b) / Math.min(a, b)) * 10000;
        })()
      : 0;

  return (
    <div className="stack">
      <Card title="模拟交易概览" subtitle="20 个测试账户在后台脚本与页面里随机交易、添加 / 撤销流动性">
        <div className="stat-row">
          <Stat label="累计成交" value={stats.swaps} hint="Swap 事件数" />
          <Stat label="添加流动性" value={stats.adds} hint="铸造的 ERC721" />
          <Stat label="撤销流动性" value={stats.removes} hint="销毁的 ERC721" />
          <Stat label="套利" value={`${stats.arbs} 次`} hint={`利润 ${fmt(stats.profit, 2)} TKB`} />
          <Stat label="当前价差" value={`${fmtNum(gap, 0)} bps`} tone={gap > 100 ? "down" : "up"} />
        </div>
      </Card>

      <Card title="TKA/TKB 价格走势" subtitle="随机交易把两个池子的价格推开，套利会让两条曲线重新靠近">
        <LineChart
          series={series}
          height={260}
          emptyHint="还没有成交数据，跑一轮模拟或做几笔交易后就会出现价格曲线"
        />
      </Card>

      <div className="grid two">
        <Card title="在页面里跑一轮随机交易" subtitle="随机选择账户、交易所、池子和方向，逐笔上链">
          <div className="form-row">
            <Field label="轮次" hint="建议 20 轮以内，方便演示">
              <input value={rounds} onChange={(event) => setRounds(event.target.value)} inputMode="numeric" />
            </Field>
            <Button onClick={runSimulation} disabled={busy}>
              {busy ? "运行中…" : "运行模拟"}
            </Button>
          </div>

          {progress.total > 0 && (
            <div className="progress">
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
              <span className="muted small">
                {progress.done} / {progress.total}
              </span>
            </div>
          )}

          {status && <Notice kind={status.includes("失败") ? "error" : "ok"}>{status}</Notice>}

          <Notice>
            命令行版本的完整模拟（100 轮 + 自动套利 + 生成报告）：
            <code>npm run simulate</code>
          </Notice>
        </Card>

        <Card title="实时操作日志" subtitle="页面上最新触发的链上操作">
          {logs.length === 0 ? (
            <Empty>点击「运行模拟」后这里会显示每一笔操作</Empty>
          ) : (
            <ul className="feed">
              {logs.map((row) => (
                <li key={row.id}>
                  <span className={`feed-dot ${row.kind === "skip" ? "gray" : ""}`} />
                  <Badge tone={row.kind === "skip" ? "gray" : "blue"}>
                    {row.kind === "skip" ? "跳过" : "swap"}
                  </Badge>
                  <span className="mono small">{row.text}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="池子快照" subtitle="所有交易对的储备与价格">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>交易所</th>
                <th>交易对</th>
                <th>储备</th>
                <th>价格</th>
                <th>成交次数</th>
              </tr>
            </thead>
            <tbody>
              {pools.map((pool) => (
                <tr key={`${pool.dexIndex}-${pool.poolId}`}>
                  <td>{pool.dexName}</td>
                  <td>
                    #{pool.poolId} {pool.symbol0}/{pool.symbol1}
                  </td>
                  <td className="mono">
                    {fmt(pool.reserve0, 2)} / {fmt(pool.reserve1, 2)}
                  </td>
                  <td className="mono">{poolPriceText(pool)}</td>
                  <td>{Number(pool.swapCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
