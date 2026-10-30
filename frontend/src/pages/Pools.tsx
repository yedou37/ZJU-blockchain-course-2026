import { useCallback, useEffect, useState } from "react";
import {
  DEXES,
  TOKENS,
  dexContract,
  errorText,
  fmt,
  fmtNum,
  formatTime,
  loadPools,
  price0In1,
  type PoolInfo,
} from "../lib/chain";
import type { PageProps } from "../lib/types";
import { Badge, Button, Card, Empty, Field, Notice } from "../components/UI";

export default function Pools({ signer, tick, bump }: PageProps) {
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
      setStatus(`${DEXES[dexIndex].name} 创建 ${tokenA}/${tokenB} 交易池成功，请到「流动性」页注入初始资金`);
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
          <Card
            key={dex.address}
            title={`${dex.name} 交易池`}
            subtitle={`合约地址 ${dex.address}`}
            actions={<Badge tone="gray">{dexPools.length} 个池子</Badge>}
          >
            {dexPools.length === 0 ? (
              <Empty>还没有交易池</Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>池子</th>
                      <th>储备</th>
                      <th>价格</th>
                      <th>总份额</th>
                      <th>交易次数</th>
                      <th>创建时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dexPools.map((pool) => (
                      <tr key={`${pool.dexIndex}-${pool.poolId}`}>
                        <td>
                          <Badge>#{pool.poolId}</Badge> {pool.symbol0}/{pool.symbol1}
                        </td>
                        <td className="mono">
                          {fmt(pool.reserve0, 2)} {pool.symbol0} / {fmt(pool.reserve1, 2)} {pool.symbol1}
                        </td>
                        <td className="mono">
                          1 {pool.symbol0} = {fmtNum(price0In1(pool), 6)} {pool.symbol1}
                        </td>
                        <td className="mono">{fmt(pool.totalShares, 2)}</td>
                        <td>{Number(pool.swapCount)}</td>
                        <td className="muted small">{formatTime(pool.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
