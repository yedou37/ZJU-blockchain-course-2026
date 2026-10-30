import { useCallback, useEffect, useState } from "react";
import {
  DEXES,
  TOKENS,
  WETH,
  arbitrageContract,
  dexContract,
  fmt,
  fmtNum,
  getEthBalance,
  loadPools,
  poolPriceText,
  shortAddr,
  tokenContract,
  wethContract,
  type PoolInfo,
} from "../lib/chain";
import type { PageProps } from "../lib/types";
import { LineChart, GapMeter, type Series } from "../components/Charts";
import { Badge, Button, Card, Empty, Notice, Stat } from "../components/UI";

type Activity = { id: string; block: number; kind: string; text: string; tone: "blue" | "green" | "gray" };

export default function Overview({ account, tick, navigate }: PageProps) {
  const [pools, setPools] = useState<PoolInfo[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [assets, setAssets] = useState<{ symbol: string; value: bigint }[]>([]);
  const [eth, setEth] = useState(0n);
  const [stats, setStats] = useState({ swaps: 0, positions: 0, arbs: 0, profit: 0n, volume: 0n });

  const load = useCallback(async () => {
    const list = await loadPools();
    setPools(list);

    let swaps = 0;
    let positions = 0;
    let volume = 0n;
    const rows: Activity[] = [];
    const priceA: number[] = [];
    const priceB: number[] = [];

    const symbolFor = (dexIndex: number, poolId: number, token?: string) => {
      const target = list.find((item) => item.dexIndex === dexIndex && item.poolId === poolId);
      if (!target || !token) return "";
      return token.toLowerCase() === target.token0.toLowerCase() ? target.symbol0 : target.symbol1;
    };
    const otherSymbol = (dexIndex: number, poolId: number, token: string) => {
      const target = list.find((item) => item.dexIndex === dexIndex && item.poolId === poolId);
      if (!target) return "";
      return token.toLowerCase() === target.token0.toLowerCase() ? target.symbol1 : target.symbol0;
    };

    for (let dexIndex = 0; dexIndex < DEXES.length; dexIndex++) {
      const dex = dexContract(dexIndex);
      const dexName = DEXES[dexIndex].name;
      const swapEvents: any[] = await dex.queryFilter(dex.filters.Swap(), 0, "latest");
      const addEvents: any[] = await dex.queryFilter(dex.filters.LiquidityAdded(), 0, "latest");
      const removeEvents: any[] = await dex.queryFilter(dex.filters.LiquidityRemoved(), 0, "latest");

      swaps += swapEvents.length;
      positions += addEvents.length - removeEvents.length;
      for (const event of swapEvents) volume += event.args.amountIn;

      for (const event of swapEvents) {
        if (Number(event.args.poolId) !== 1) continue;
        const price = Number(event.args.reserve1) / Number(event.args.reserve0);
        if (dexIndex === 0) priceA.push(price);
        else priceB.push(price);
      }

      for (const event of swapEvents.slice(-6)) {
        const poolId = Number(event.args.poolId);
        rows.push({
          id: `${event.transactionHash}-${event.index}`,
          block: event.blockNumber,
          kind: "兑换",
          tone: "blue",
          text: `${shortAddr(event.args.trader)} 在 ${dexName} 用 ${fmt(event.args.amountIn, 2)} ${symbolFor(
            dexIndex,
            poolId,
            event.args.tokenIn
          )} 换出 ${fmt(event.args.amountOut, 2)} ${otherSymbol(dexIndex, poolId, event.args.tokenIn)}`,
        });
      }
      for (const event of addEvents.slice(-4)) {
        rows.push({
          id: `${event.transactionHash}-${event.index}`,
          block: event.blockNumber,
          kind: "加流动性",
          tone: "green",
          text: `${shortAddr(event.args.provider)} 在 ${dexName} 注入 ${fmt(event.args.amount0, 1)} + ${fmt(
            event.args.amount1,
            1
          )}，铸造 NFT #${event.args.positionId}`,
        });
      }
      for (const event of removeEvents.slice(-3)) {
        rows.push({
          id: `${event.transactionHash}-${event.index}`,
          block: event.blockNumber,
          kind: "撤流动性",
          tone: "gray",
          text: `${shortAddr(event.args.provider)} 销毁 NFT #${event.args.positionId}，取回 ${fmt(
            event.args.amount0,
            2
          )} + ${fmt(event.args.amount1, 2)}`,
        });
      }
    }

    const arbitrage = arbitrageContract();
    const arbEvents: any[] = await arbitrage.queryFilter(arbitrage.filters.ArbitrageExecuted(), 0, "latest");
    let profit = 0n;
    for (const event of arbEvents) {
      profit += event.args.profit;
      rows.push({
        id: `${event.transactionHash}-${event.index}`,
        block: event.blockNumber,
        kind: "套利",
        tone: "green",
        text: `套利者 ${shortAddr(event.args.trader)} 低买高卖，净赚 ${fmt(event.args.profit, 2)} TKB`,
      });
    }

    setStats({ swaps, positions, arbs: arbEvents.length, profit, volume });
    setSeries([
      { label: `${DEXES[0].name} TKA/TKB`, color: "#2f6bff", points: priceA.slice(-80) },
      { label: `${DEXES[1].name} TKA/TKB`, color: "#e8722b", points: priceB.slice(-80) },
    ]);
    setActivity(rows.sort((a, b) => b.block - a.block).slice(0, 9));

    if (account) {
      const list2: { symbol: string; value: bigint }[] = [];
      for (const token of TOKENS) {
        list2.push({ symbol: token.symbol, value: await tokenContract(token.address).balanceOf(account) });
      }
      list2.push({ symbol: "WETH", value: await wethContract().balanceOf(account) });
      setAssets(list2);
      setEth(await getEthBalance(account));
    }
  }, [account]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load, tick]);

  const poolA = pools.find((pool) => pool.dexIndex === 0 && pool.poolId === 1);
  const poolB = pools.find((pool) => pool.dexIndex === 1 && pool.poolId === 1);
  const priceA = poolA ? Number(poolA.reserve1) / Math.max(Number(poolA.reserve0), 1) : 0;
  const priceB = poolB ? Number(poolB.reserve1) / Math.max(Number(poolB.reserve0), 1) : 0;
  const gap = priceA > 0 && priceB > 0 ? (Math.abs(priceA - priceB) / Math.min(priceA, priceB)) * 10000 : 0;

  return (
    <div className="stack">
      <section className="hero">
        <div className="hero-copy">
          <span className="pill">AMM · Uniswap V2 风格</span>
          <h2>一个交易所，两种玩法：做市赚手续费，套利赚价差</h2>
          <p className="muted">
            两个 MiniDEX 实例部署在同一套代币上，TKA/TKB 池的初始价格分别为 1.0 与 0.8。
            随机交易会把价格推开，套利合约在一笔交易内把它拉回来。
          </p>
          <div className="button-row">
            <Button onClick={() => navigate("faucet")}>领取测试币</Button>
            <Button variant="ghost" onClick={() => navigate("trade")}>
              去兑换
            </Button>
            <Button variant="ghost" onClick={() => navigate("arbitrage")}>
              看套利机会
            </Button>
          </div>
        </div>
        <div className="hero-metrics">
          <div className="hero-metric">
            <span>当前价差</span>
            <strong className={gap > 60 ? "up" : "down"}>{fmtNum(gap, 0)} bps</strong>
          </div>
          <div className="hero-metric">
            <span>累计成交</span>
            <strong>{stats.swaps}</strong>
          </div>
          <div className="hero-metric">
            <span>套利利润</span>
            <strong>{fmt(stats.profit, 2)}</strong>
            <span className="muted small">TKB</span>
          </div>
        </div>
      </section>

      <div className="stat-row four">
        <Stat label="交易池" value={`${pools.length} 个`} hint={`${DEXES.length} 个交易所实例`} />
        <Stat label="流动性凭证" value={`${stats.positions} 枚`} hint="ERC721 NFT" />
        <Stat label="累计成交" value={`${stats.swaps} 笔`} hint={`${DEXES.length} 个交易所合计`} />
        <Stat label="套利次数" value={`${stats.arbs} 次`} hint={`利润 ${fmt(stats.profit, 2)} TKB`} />
      </div>

      <div className="grid two">
        <Card title="TKA/TKB 价格走势" subtitle="每个点是一笔成交后的池子价格，两条曲线的距离就是套利空间">
          <LineChart
            series={series}
            height={250}
            emptyHint="还没有成交数据，去「兑换」页做几笔交易，或到「模拟交易」页跑一轮随机交易"
          />
          <GapMeter bps={gap} />
        </Card>

        <Card
          title="我的资产"
          subtitle={`当前账户 ${shortAddr(account)}`}
          actions={
            <Button size="sm" variant="ghost" onClick={() => navigate("liquidity")}>
              我的 NFT
            </Button>
          }
        >
          <div className="asset-list">
            {assets.map((item) => (
              <div className="asset-row" key={item.symbol}>
                <span className="asset-symbol">{item.symbol}</span>
                <span className="mono">{fmt(item.value, 4)}</span>
              </div>
            ))}
            <div className="asset-row">
              <span className="asset-symbol">ETH</span>
              <span className="mono">{fmt(eth, 4)}</span>
            </div>
          </div>
          <Notice>
            测试 ETH 可以包装成 WETH 参与 TKA/WETH 交易对；WETH 合约地址 <code>{shortAddr(WETH.address)}</code>
          </Notice>
        </Card>
      </div>

      <div className="grid two">
        <Card title="最近链上活动" subtitle="直接读取事件日志，按区块倒序">
          {activity.length === 0 ? (
            <Empty>还没有链上活动</Empty>
          ) : (
            <ul className="feed">
              {activity.map((row) => (
                <li key={row.id}>
                  <span className="feed-dot" />
                  <Badge tone={row.tone}>{row.kind}</Badge>
                  <span className="mono small">{row.text}</span>
                  <span className="feed-block">#{row.block}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="交易池概览"
          subtitle="储备、价格与成交次数"
          actions={
            <Button size="sm" variant="ghost" onClick={() => navigate("pools")}>
              全部池子
            </Button>
          }
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>交易所</th>
                  <th>交易对</th>
                  <th>价格</th>
                  <th>成交</th>
                </tr>
              </thead>
              <tbody>
                {pools.map((pool) => (
                  <tr key={`${pool.dexIndex}-${pool.poolId}`}>
                    <td>{pool.dexName}</td>
                    <td>
                      #{pool.poolId} {pool.symbol0}/{pool.symbol1}
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
    </div>
  );
}
