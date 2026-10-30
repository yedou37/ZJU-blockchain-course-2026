import { useCallback, useEffect, useMemo, useState } from "react";
import { MaxUint256 } from "ethers";
import {
  DEXES,
  dexContract,
  errorText,
  fmt,
  fmtNum,
  loadPools,
  parseAmount,
  price0In1,
  shortAddr,
  tokenContract,
  type PoolInfo,
} from "../lib/chain";
import type { PageProps } from "../lib/types";
import { Badge, Button, Card, Empty, Field, Notice, Stat } from "../components/UI";

type SwapRow = { trader: string; amountIn: bigint; amountOut: bigint; tokenIn: string; block: number };

export default function Trade({ account, signer, tick, bump }: PageProps) {
  const [pools, setPools] = useState<PoolInfo[]>([]);
  const [selected, setSelected] = useState("0-1");
  const [direction, setDirection] = useState<0 | 1>(0);
  const [amount, setAmount] = useState("100");
  const [slippage, setSlippage] = useState("0.5");
  const [quote, setQuote] = useState<bigint>(0n);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState<bigint>(0n);
  const [history, setHistory] = useState<SwapRow[]>([]);

  const load = useCallback(async () => {
    setPools(await loadPools());
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load, tick]);

  const pool = useMemo(() => {
    const [dexIndex, poolId] = selected.split("-").map(Number);
    return pools.find((item) => item.dexIndex === dexIndex && item.poolId === poolId);
  }, [pools, selected]);

  const tokenIn = pool ? (direction === 0 ? pool.token0 : pool.token1) : "";
  const tokenOut = pool ? (direction === 0 ? pool.token1 : pool.token0) : "";
  const symbolIn = pool ? (direction === 0 ? pool.symbol0 : pool.symbol1) : "";
  const symbolOut = pool ? (direction === 0 ? pool.symbol1 : pool.symbol0) : "";
  const reserveIn = pool ? (direction === 0 ? pool.reserve0 : pool.reserve1) : 0n;
  const reserveOut = pool ? (direction === 0 ? pool.reserve1 : pool.reserve0) : 0n;

  const amountIn = parseAmount(amount);

  useEffect(() => {
    let alive = true;
    if (!pool || amountIn === 0n) {
      setQuote(0n);
      return;
    }
    dexContract(pool.dexIndex)
      .getAmountOut(pool.poolId, tokenIn, amountIn)
      .then((value: bigint) => alive && setQuote(value))
      .catch(() => alive && setQuote(0n));
    return () => {
      alive = false;
    };
  }, [pool, tokenIn, amountIn, tick]);

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

  useEffect(() => {
    let alive = true;
    if (!pool) return;
    const dex = dexContract(pool.dexIndex);
    dex
      .queryFilter(dex.filters.Swap(pool.poolId), 0, "latest")
      .then((events: any[]) => {
        if (!alive) return;
        setHistory(
          events
            .slice(-5)
            .reverse()
            .map((event) => ({
              trader: event.args.trader,
              tokenIn: event.args.tokenIn,
              amountIn: event.args.amountIn,
              amountOut: event.args.amountOut,
              block: event.blockNumber,
            }))
        );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [pool, tick]);

  const midPrice = reserveIn > 0n ? Number(reserveOut) / Number(reserveIn) : 0;
  const execPrice = amountIn > 0n ? Number(quote) / Number(amountIn) : 0;
  const priceImpact = midPrice > 0 && execPrice > 0 ? (1 - execPrice / midPrice) * 100 : 0;
  const slippageBps = Math.round(Number(slippage || "0") * 100);
  const minOut = (quote * BigInt(10_000 - Math.min(slippageBps, 9_999))) / 10_000n;

  const swap = async () => {
    if (!signer || !pool || amountIn === 0n) return;
    setBusy(true);
    setStatus("交易提交中…");
    try {
      const dexAddress = DEXES[pool.dexIndex].address;
      const inContract = tokenContract(tokenIn, signer);
      const allowance: bigint = await inContract.allowance(account, dexAddress);
      if (allowance < amountIn) {
        setStatus(`授权 ${symbolIn}…`);
        await (await inContract.approve(dexAddress, MaxUint256)).wait();
      }
      const dex = dexContract(pool.dexIndex, signer);
      setStatus("交易打包中…");
      const tx = await dex.swapExactIn(pool.poolId, tokenIn, amountIn, minOut, account);
      await tx.wait();
      setStatus(`交易成功：${amount} ${symbolIn} → 至少 ${fmt(minOut, 4)} ${symbolOut}（tx ${tx.hash.slice(0, 10)}…）`);
      bump();
      await load();
    } catch (error) {
      setStatus(`交易失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid two">
      <Card title="兑换" subtitle="恒定乘积做市：支付 0.3% 手续费，滑点随交易量增大">
        <div className="form-row">
          <Field label="交易池">
            <select value={selected} onChange={(event) => setSelected(event.target.value)}>
              {pools.map((item) => (
                <option key={`${item.dexIndex}-${item.poolId}`} value={`${item.dexIndex}-${item.poolId}`}>
                  {item.dexName} · #{item.poolId} {item.symbol0}/{item.symbol1}
                </option>
              ))}
            </select>
          </Field>
          <Field label="方向">
            <select value={direction} onChange={(event) => setDirection(Number(event.target.value) as 0 | 1)}>
              <option value={0}>
                {pool?.symbol0 ?? "token0"} → {pool?.symbol1 ?? "token1"}
              </option>
              <option value={1}>
                {pool?.symbol1 ?? "token1"} → {pool?.symbol0 ?? "token0"}
              </option>
            </select>
          </Field>
        </div>

        <div className="form-row">
          <Field label={`支付数量（${symbolIn}）`} hint={`余额 ${fmt(balance, 4)} ${symbolIn}`}>
            <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" />
          </Field>
          <Field label="滑点容忍 (%)">
            <input value={slippage} onChange={(event) => setSlippage(event.target.value)} inputMode="decimal" />
          </Field>
        </div>

        <div className="stat-row">
          <Stat label="预计得到" value={`${fmt(quote, 6)} ${symbolOut}`} />
          <Stat label="最少得到" value={`${fmt(minOut, 6)} ${symbolOut}`} hint={`滑点 ${slippage || 0}%`} />
          <Stat
            label="价格冲击"
            value={`${fmtNum(priceImpact, 3)}%`}
            tone={priceImpact > 1 ? "down" : "up"}
            hint={`成交价 ${fmtNum(execPrice, 6)}`}
          />
        </div>

        <div className="button-row">
          <Button onClick={swap} disabled={busy || !signer || amountIn === 0n}>
            执行兑换
          </Button>
          <Button variant="ghost" onClick={() => setAmount(fmt(balance, 18).replace(/,/g, ""))}>
            全部
          </Button>
        </div>

        {status && <Notice kind={status.includes("失败") ? "error" : "ok"}>{status}</Notice>}
      </Card>

      <div className="stack">
        <Card title="池子状态" subtitle="兑换后储备与价格会随之变化">
          {!pool ? (
            <Empty>请选择交易池</Empty>
          ) : (
            <div className="stat-row">
              <Stat label={`${pool.symbol0} 储备`} value={fmt(pool.reserve0, 4)} />
              <Stat label={`${pool.symbol1} 储备`} value={fmt(pool.reserve1, 4)} />
              <Stat label="价格" value={`${fmtNum(price0In1(pool), 6)} ${pool.symbol1}`} hint={`1 ${pool.symbol0}`} />
              <Stat
                label="k = x·y"
                value={Number(pool.reserve0 * pool.reserve1).toExponential(3)}
                hint="恒定乘积"
              />
            </div>
          )}
        </Card>

        <Card title="最近成交" subtitle="直接读取链上 Swap 事件">
          {history.length === 0 ? (
            <Empty>该池还没有成交记录</Empty>
          ) : (
            <ul className="list">
              {history.map((row) => (
                <li key={`${row.block}-${row.trader}-${row.amountIn}`}>
                  <Badge tone="gray">#{row.block}</Badge>
                  <span className="mono">
                    {shortAddr(row.trader)} 用 {fmt(row.amountIn, 3)}{" "}
                    {row.tokenIn.toLowerCase() === pool?.token0.toLowerCase() ? pool?.symbol0 : pool?.symbol1} 换出{" "}
                    {fmt(row.amountOut, 3)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
