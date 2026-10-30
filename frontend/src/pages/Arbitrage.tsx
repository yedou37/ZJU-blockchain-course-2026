import { useCallback, useEffect, useState } from "react";
import { MaxUint256 } from "ethers";
import {
  ARBITRAGE,
  DEXES,
  arbitrageContract,
  dexContract,
  errorText,
  fmt,
  fmtNum,
  loadPools,
  parseAmount,
  shortAddr,
  tokenContract,
  type PoolInfo,
} from "../lib/chain";
import type { PageProps } from "../lib/types";
import { BarCompare, GapMeter } from "../components/Charts";
import { Badge, Button, Card, Empty, Field, Notice, Stat } from "../components/UI";

type Plan = {
  tokenOut: string;
  midAmount: bigint;
  finalAmount: bigint;
  profit: bigint;
  priceBuy: bigint;
  priceSell: bigint;
};

type Result = {
  profit: bigint;
  amountIn: bigint;
  amountOut: bigint;
  priceBefore: [number, number];
  priceAfter: [number, number];
  hash: string;
};

const STEPS = [
  { title: "拉取资金", desc: "transferFrom 把 tokenIn 从套利者转入合约" },
  { title: "低价买入", desc: "在便宜的池子 swapExactIn，把 tokenIn 换成 tokenOut" },
  { title: "高价卖出", desc: "在贵的池子卖回 tokenIn" },
  { title: "利润校验", desc: "回款 < 本金 + minProfit 则整笔 revert" },
];

export default function Arbitrage({ account, signer, tick, bump }: PageProps) {
  const [pools, setPools] = useState<PoolInfo[]>([]);
  const [amount, setAmount] = useState("500");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [balance, setBalance] = useState<bigint>(0n);
  const [result, setResult] = useState<Result | null>(null);
  const [history, setHistory] = useState<any[]>([]);

  const load = useCallback(async () => {
    setPools(await loadPools());
    const arbitrage = arbitrageContract();
    const events: any[] = await arbitrage.queryFilter(arbitrage.filters.ArbitrageExecuted(), 0, "latest");
    setHistory(events.slice(-5).reverse());
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load, tick]);

  const poolA = pools.find((pool) => pool.dexIndex === 0 && pool.poolId === 1);
  const poolB = pools.find((pool) => pool.dexIndex === 1 && pool.poolId === 1);

  const priceA = poolA ? Number(poolA.reserve1) / Math.max(Number(poolA.reserve0), 1) : 0;
  const priceB = poolB ? Number(poolB.reserve1) / Math.max(Number(poolB.reserve0), 1) : 0;
  const gapBps = priceA > 0 && priceB > 0 ? (Math.abs(priceA - priceB) / Math.min(priceA, priceB)) * 10000 : 0;

  // TKA 更便宜的那个交易所买入，更贵的那个卖出；用 TKB 作为投入代币
  const buyIndex = priceA <= priceB ? 0 : 1;
  const sellIndex = 1 - buyIndex;
  const tokenIn = poolA?.token1 ?? "";
  const symbolIn = poolA?.symbol1 ?? "TKB";
  const symbolOut = poolA?.symbol0 ?? "TKA";

  useEffect(() => {
    let alive = true;
    if (!tokenIn || !account) return;
    tokenContract(tokenIn)
      .balanceOf(account)
      .then((value: bigint) => alive && setBalance(value))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [tokenIn, account, tick]);

  const refreshPlan = useCallback(
    async (value: bigint) => {
      if (!poolA || !poolB || value === 0n) {
        setPlan(null);
        return;
      }
      try {
        const preview = await arbitrageContract().preview(
          DEXES[buyIndex].address,
          1,
          DEXES[sellIndex].address,
          1,
          tokenIn,
          value
        );
        setPlan({
          tokenOut: preview.tokenOut,
          midAmount: preview.midAmount,
          finalAmount: preview.finalAmount,
          profit: preview.profit,
          priceBuy: preview.priceBuyBefore,
          priceSell: preview.priceSellBefore,
        });
      } catch {
        setPlan(null);
      }
    },
    [poolA, poolB, buyIndex, sellIndex, tokenIn]
  );

  useEffect(() => {
    // 套利成功后价格已经变化，保留成交时的预估，避免面板被自动刷新覆盖
    if (frozen) return;
    refreshPlan(parseAmount(amount)).catch(() => undefined);
  }, [amount, refreshPlan, tick, frozen]);

  const findOptimal = async () => {
    if (!poolA || !poolB) return;
    setBusy(true);
    setFrozen(false);
    setStatus("正在采样搜索最优投入量…");
    try {
      const arbitrage = arbitrageContract();
      const maxIn = balance < 10n ** 22n ? balance : 10n ** 22n;
      let best = { amount: 0n, profit: 0n };
      for (let step = 1; step <= 40; step++) {
        const candidate = (maxIn * BigInt(step)) / 40n;
        if (candidate === 0n) continue;
        const preview = await arbitrage.preview(
          DEXES[buyIndex].address,
          1,
          DEXES[sellIndex].address,
          1,
          tokenIn,
          candidate
        );
        if (preview.profit > best.profit) best = { amount: candidate, profit: preview.profit };
      }
      if (best.amount === 0n) {
        setStatus("当前没有可盈利的套利机会");
      } else {
        setAmount(fmt(best.amount, 18).replace(/,/g, ""));
        await refreshPlan(best.amount);
        setStatus(`最优投入 ${fmt(best.amount, 2)} ${symbolIn}，预计利润 ${fmt(best.profit, 4)} ${symbolIn}`);
      }
    } catch (error) {
      setStatus(`搜索失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    if (!signer || !plan) return;
    const amountIn = parseAmount(amount);
    if (amountIn === 0n) return;
    setBusy(true);
    setStatus("套利交易提交中…");
    const before: [number, number] = [priceA, priceB];
    try {
      const inContract = tokenContract(tokenIn, signer);
      const allowance: bigint = await inContract.allowance(account, ARBITRAGE);
      if (allowance < amountIn) {
        setStatus(`授权 ${symbolIn} 给套利合约…`);
        await (await inContract.approve(ARBITRAGE, MaxUint256)).wait();
      }
      const arbitrage = arbitrageContract(signer);
      const minProfit = (plan.profit * 9n) / 10n;
      setStatus("执行：买入 → 卖出（一笔交易内完成）…");
      const tx = await arbitrage.execute(
        DEXES[buyIndex].address,
        1,
        DEXES[sellIndex].address,
        1,
        tokenIn,
        amountIn,
        minProfit
      );
      const receipt = await tx.wait();
      const poolsAfter = await loadPools();
      const afterA = poolsAfter.find((pool) => pool.dexIndex === 0 && pool.poolId === 1);
      const afterB = poolsAfter.find((pool) => pool.dexIndex === 1 && pool.poolId === 1);
      setResult({
        profit: plan.profit,
        amountIn,
        amountOut: plan.finalAmount,
        priceBefore: before,
        priceAfter: [
          afterA ? Number(afterA.reserve1) / Math.max(Number(afterA.reserve0), 1) : 0,
          afterB ? Number(afterB.reserve1) / Math.max(Number(afterB.reserve0), 1) : 0,
        ],
        hash: receipt?.hash ?? tx.hash,
      });
      setStatus("套利成功");
      setFrozen(true);
      bump();
      await load();
    } catch (error) {
      setStatus(`套利失败（交易已 revert，两笔 swap 一起回滚）：${errorText(error)}`);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const profitable = plan !== null && plan.profit > 0n;

  return (
    <div className="stack">
      <Card
        title="价差监控（Bonus ①）"
        subtitle="两个交易所里存在同一个 TKA/TKB 交易对，价格不同就存在套利空间"
        actions={<Badge tone={gapBps > 100 ? "green" : "gray"}>价差 {fmtNum(gapBps, 0)} bps</Badge>}
      >
        <div className="grid two">
          {[poolA, poolB].map((pool, index) =>
            pool ? (
              <div className="pool-card" key={pool.dexName}>
                <div className="pool-card-head">
                  <strong>{pool.dexName}</strong>
                  <span className="muted small">
                    #{pool.poolId} {pool.symbol0}/{pool.symbol1}
                  </span>
                </div>
                <div className="stat-row">
                  <Stat label={`${pool.symbol0} 储备`} value={fmt(pool.reserve0, 2)} />
                  <Stat label={`${pool.symbol1} 储备`} value={fmt(pool.reserve1, 2)} />
                  <Stat
                    label="价格"
                    value={`${fmtNum(index === 0 ? priceA : priceB, 6)}`}
                    hint={`1 ${pool.symbol0} = ? ${pool.symbol1}`}
                    tone={index === buyIndex ? "up" : "down"}
                  />
                </div>
              </div>
            ) : null
          )}
        </div>

        <GapMeter bps={gapBps} />
        <Notice>
          套利方向：在 <strong>{DEXES[buyIndex].name}</strong>（TKA 更便宜）用 {symbolIn} 买入 {symbolOut}，再到{" "}
          <strong>{DEXES[sellIndex].name}</strong> 卖出换回 {symbolIn}。
        </Notice>
      </Card>

      <div className="grid two">
        <Card title="执行原子套利（Bonus ②）" subtitle="一次交易内完成买入与卖出，不达目标利润则整体回滚">
          <div className="form-row">
            <Field label={`投入数量（${symbolIn}）`} hint={`余额 ${fmt(balance, 4)} ${symbolIn}`}>
              <input
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setFrozen(false);
                }}
                inputMode="decimal"
              />
            </Field>
            <Button variant="ghost" onClick={findOptimal} disabled={busy}>
              搜索最优投入
            </Button>
          </div>

          <div className="stat-row">
            <Stat label="买入得到" value={`${fmt(plan?.midAmount ?? 0n, 4)} ${symbolOut}`} />
            <Stat label="卖出回款" value={`${fmt(plan?.finalAmount ?? 0n, 4)} ${symbolIn}`} />
            <Stat
              label="预计利润"
              value={`${fmt(plan?.profit ?? 0n, 4)} ${symbolIn}`}
              tone={profitable ? "up" : undefined}
              hint={
                plan && parseAmount(amount) > 0n
                  ? `收益率 ${fmtNum((Number(plan.profit) / Number(parseAmount(amount))) * 100, 2)}%`
                  : undefined
              }
            />
          </div>

          <div className="steps">
            {STEPS.map((step, index) => (
              <div className={`step ${result ? "done" : ""}`} key={step.title}>
                <span className="step-index">{index + 1}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p className="muted small">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="button-row">
            <Button onClick={execute} disabled={busy || !signer || !profitable}>
              一键套利
            </Button>
          </div>
          {!profitable && plan && !frozen && (
            <Notice kind="error">当前价差不足以覆盖手续费，套利会 revert</Notice>
          )}
          {status && <Notice kind={status.includes("失败") ? "error" : "ok"}>{status}</Notice>}
        </Card>

        <Card title="套利结果" subtitle="套利前后的价格、数量与盈利">
          {!result ? (
            <Empty>执行一次套利后这里会显示前后对比</Empty>
          ) : (
            <>
              <div className="stat-row">
                <Stat label="投入" value={`${fmt(result.amountIn, 4)} ${symbolIn}`} />
                <Stat label="回款" value={`${fmt(result.amountOut, 4)} ${symbolIn}`} />
                <Stat label="净利润" value={`${fmt(result.profit, 4)} ${symbolIn}`} tone="up" />
              </div>
              <BarCompare
                groups={[
                  { label: DEXES[0].name, before: result.priceBefore[0], after: result.priceAfter[0] },
                  { label: DEXES[1].name, before: result.priceBefore[1], after: result.priceAfter[1] },
                ]}
              />
              <p className="muted small mono">tx: {result.hash}</p>
            </>
          )}
        </Card>
      </div>

      <Card title="最近套利记录" subtitle="链上 ArbitrageExecuted 事件">
        {history.length === 0 ? (
          <Empty>还没有套利记录</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>套利者</th>
                  <th>路径</th>
                  <th>投入</th>
                  <th>回款</th>
                  <th>利润</th>
                  <th>区块</th>
                </tr>
              </thead>
              <tbody>
                {history.map((event) => (
                  <tr key={`${event.transactionHash}-${event.index}`}>
                    <td className="mono">{shortAddr(event.args.trader)}</td>
                    <td>
                      {DEXES.find((dex) => dex.address.toLowerCase() === event.args.buyDEX.toLowerCase())?.name} →{" "}
                      {DEXES.find((dex) => dex.address.toLowerCase() === event.args.sellDEX.toLowerCase())?.name}
                    </td>
                    <td className="mono">{fmt(event.args.amountIn, 2)}</td>
                    <td className="mono">{fmt(event.args.amountOut, 2)}</td>
                    <td className="mono up">{fmt(event.args.profit, 2)}</td>
                    <td>#{event.blockNumber}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
