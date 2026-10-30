import { useCallback, useEffect, useState } from "react";
import {
  DEXES,
  TOKENS,
  dexContract,
  errorText,
  fmt,
  formatTime,
  loadPools,
  poolPriceText,
  shortAddr,
  type PoolInfo,
} from "../lib/chain";
import type { PageProps } from "../lib/types";
import { Badge, Button, Card, Empty, Field, Notice } from "../components/UI";

const TOKEN_COLORS: Record<string, string> = {
  TKA: "#2f6bff",
  TKB: "#e8722b",
  TKC: "#0a8f5b",
  WETH: "#8b5cf6",
};

export default function Pools({ signer, tick, bump, navigate }: PageProps) {
  const [pools, setPools] = useState<PoolInfo[]>([]);
  const [dexIndex, setDexIndex] = useState(0);
  const [tokenA, setTokenA] = useState(TOKENS[0].symbol);
  const [tokenB, setTokenB] = useState(TOKENS[1].symbol);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setPools(await loadPools());
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load, tick]);

  const createPool = async () => {
    if (!signer) return;
    if (tokenA === tokenB) {
      setStatus("两个代币不能相同");
      return;
    }
    setBusy(true);
    setStatus("创建交易池中…");
    try {
      const addressA = TOKENS.find((t) => t.symbol === tokenA)!.address;
      const addressB = TOKENS.find((t) => t.symbol === tokenB)!.address;
      const dex = dexContract(dexIndex, signer);
      const tx = await dex.createPool(addressA, addressB);
      await tx.wait();
      setStatus(`${DEXES[dexIndex].name} 创建 ${tokenA}/${tokenB} 交易池成功，接着去「流动性」注入初始资金`);
      bump();
      await load();
    } catch (error) {
      setStatus(`创建失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <Card
        title="创建交易池"
        subtitle="同一个交易对在每个交易所里只能有一个池子，代币地址会自动排序为 token0 / token1"
      >
        <div className="form-row">
          <Field label="交易所">
            <select value={dexIndex} onChange={(event) => setDexIndex(Number(event.target.value))}>
              {DEXES.map((dex, index) => (
                <option key={dex.address} value={index}>
                  {dex.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="代币 A">
            <select value={tokenA} onChange={(event) => setTokenA(event.target.value)}>
              {TOKENS.map((token) => (
                <option key={token.symbol} value={token.symbol}>
                  {token.symbol}
                </option>
              ))}
            </select>
          </Field>
          <Field label="代币 B">
            <select value={tokenB} onChange={(event) => setTokenB(event.target.value)}>
              {TOKENS.map((token) => (
                <option key={token.symbol} value={token.symbol}>
                  {token.symbol}
                </option>
              ))}
            </select>
          </Field>
          <Button onClick={createPool} disabled={busy || !signer}>
            创建交易池
          </Button>
        </div>
        {status && <Notice kind={status.includes("失败") ? "error" : "ok"}>{status}</Notice>}
      </Card>

      {DEXES.map((dex, index) => {
        const dexPools = pools.filter((pool) => pool.dexIndex === index);
        return (
          <section key={dex.address} className="dex-section">
            <header className="section-head">
              <div>
                <h2>{dex.name}</h2>
                <p className="muted small mono">{dex.address}</p>
              </div>
              <Badge tone="gray">{dexPools.length} 个池子</Badge>
            </header>

            {dexPools.length === 0 ? (
              <Empty>还没有交易池</Empty>
            ) : (
              <div className="pool-grid">
                {dexPools.map((pool) => {
                  const maxReserve = Math.max(Number(pool.reserve0), Number(pool.reserve1), 1);
                  return (
                    <article className="pool-tile" key={`${pool.dexIndex}-${pool.poolId}`}>
                      <div className="pool-tile-head">
                        <div className="pair">
                          <span className="token-dot" style={{ background: TOKEN_COLORS[pool.symbol0] }} />
                          <strong>{pool.symbol0}</strong>
                          <span className="muted">/</span>
                          <span className="token-dot" style={{ background: TOKEN_COLORS[pool.symbol1] }} />
                          <strong>{pool.symbol1}</strong>
                        </div>
                        <Badge>#{pool.poolId}</Badge>
                      </div>

                      <div className="pool-price">{poolPriceText(pool)}</div>

                      <div className="reserve-bars">
                        <div className="reserve-row">
                          <span className="muted small">{pool.symbol0}</span>
                          <div className="reserve-track">
                            <div
                              className="reserve-fill"
                              style={{
                                width: `${(Number(pool.reserve0) / maxReserve) * 100}%`,
                                background: TOKEN_COLORS[pool.symbol0] ?? "#94a3b8",
                              }}
                            />
                          </div>
                          <span className="mono small">{fmt(pool.reserve0, 2)}</span>
                        </div>
                        <div className="reserve-row">
                          <span className="muted small">{pool.symbol1}</span>
                          <div className="reserve-track">
                            <div
                              className="reserve-fill"
                              style={{
                                width: `${(Number(pool.reserve1) / maxReserve) * 100}%`,
                                background: TOKEN_COLORS[pool.symbol1] ?? "#94a3b8",
                              }}
                            />
                          </div>
                          <span className="mono small">{fmt(pool.reserve1, 2)}</span>
                        </div>
                      </div>

                      <div className="pool-meta">
                        <span>总份额 {fmt(pool.totalShares, 2)}</span>
                        <span>成交 {Number(pool.swapCount)} 次</span>
                        <span className="muted small">{formatTime(pool.createdAt)}</span>
                      </div>

                      <div className="button-row">
                        <Button size="sm" onClick={() => navigate("trade")}>
                          兑换
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => navigate("liquidity")}>
                          加流动性
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      <Card title="小提示" subtitle="每个池子都在链上维护 reserve0 / reserve1 / totalShares">
        <ul className="list">
          <li>
            <Badge tone="gray">建池</Badge>
            <span className="mono small">
              同一交易对只能建一个池，地址排序后 token0 &lt; token1，避免重复池子
            </span>
          </li>
          <li>
            <Badge tone="gray">份额</Badge>
            <span className="mono small">
              首次注资 shares = √(x·y)，之后按比例配比，份额代表你在池子里的所有权
            </span>
          </li>
          <li>
            <Badge tone="gray">交易所</Badge>
            <span className="mono small">
              两个交易所相互独立，同一交易对价格不同就产生套利空间（见「套利」页）
            </span>
          </li>
        </ul>
        <p className="muted small">
          合约：{DEXES.map((dex) => `${dex.name} ${shortAddr(dex.address)}`).join(" · ")}
        </p>
      </Card>
    </div>
  );
}
