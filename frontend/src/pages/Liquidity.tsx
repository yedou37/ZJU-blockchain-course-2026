import { useCallback, useEffect, useState } from "react";
import { MaxUint256 } from "ethers";
import {
  DEXES,
  dexContract,
  errorText,
  fmt,
  fmtNum,
  formatTime,
  loadPools,
  parseAmount,
  shortAddr,
  tokenContract,
  type PoolInfo,
  type PositionInfo,
} from "../lib/chain";
import type { PageProps } from "../lib/types";
import { Badge, Button, Card, Empty, Field, Notice, Stat } from "../components/UI";

export default function Liquidity({ account, signer, tick, bump }: PageProps) {
  const [pools, setPools] = useState<PoolInfo[]>([]);
  const [selected, setSelected] = useState("0-1");
  const [amount0, setAmount0] = useState("100");
  const [amount1, setAmount1] = useState("100");
  const [mine, setMine] = useState<PositionInfo[]>([]);
  const [all, setAll] = useState<PositionInfo[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const list = await loadPools();
    setPools(list);

    const mineRows: PositionInfo[] = [];
    const allRows: PositionInfo[] = [];

    for (let dexIndex = 0; dexIndex < DEXES.length; dexIndex++) {
      const dex = dexContract(dexIndex);
      const rows: any[] = await dex.getAllPositions();

      for (const row of rows) {
        if (row.shares === 0n) continue; // 已销毁的 NFT
        const pool = list.find((item) => item.dexIndex === dexIndex && item.poolId === Number(row.poolId));
        if (!pool) continue;
        const info: PositionInfo = {
          dexIndex,
          dexName: DEXES[dexIndex].name,
          tokenId: Number(row.tokenId),
          poolId: Number(row.poolId),
          shares: row.shares,
          createdAt: row.createdAt,
          owner: row.owner,
          amount0AtMint: row.amount0,
          amount1AtMint: row.amount1,
          redeem0: row.amount0,
          redeem1: row.amount1,
          symbol0: pool.symbol0,
          symbol1: pool.symbol1,
        };
        allRows.push(info);
        if (info.owner.toLowerCase() === account.toLowerCase()) mineRows.push(info);
      }
    }

    setMine(mineRows.sort((a, b) => b.tokenId - a.tokenId));
    setAll(allRows.sort((a, b) => b.tokenId - a.tokenId).slice(0, 40));
    setLoading(false);
  }, [account]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load, tick]);

  const pool = (() => {
    const [dexIndex, poolId] = selected.split("-").map(Number);
    return pools.find((item) => item.dexIndex === dexIndex && item.poolId === poolId);
  })();

  // 按池子比例自动换算另一种代币的数量
  useEffect(() => {
    if (!pool || pool.reserve0 === 0n || pool.reserve1 === 0n) return;
    const value = parseAmount(amount0);
    if (value === 0n) return;
    const computed = (value * pool.reserve1) / pool.reserve0;
    setAmount1(fmt(computed, 18).replace(/,/g, ""));
  }, [amount0, pool]);

  const add = async () => {
    if (!signer || !pool) return;
    const value0 = parseAmount(amount0);
    const value1 = parseAmount(amount1);
    if (value0 === 0n || value1 === 0n) {
      setStatus("两种代币的数量都要大于 0");
      return;
    }
    setBusy(true);
    setStatus("添加流动性中…");
    try {
      const dexAddress = DEXES[pool.dexIndex].address;
      for (const token of [pool.token0, pool.token1]) {
        const contract = tokenContract(token, signer);
        const allowance: bigint = await contract.allowance(account, dexAddress);
        if (allowance < (token === pool.token0 ? value0 : value1)) {
          await (await contract.approve(dexAddress, MaxUint256)).wait();
        }
      }
      const dex = dexContract(pool.dexIndex, signer);
      const tx = await dex.addLiquidity(pool.poolId, value0, value1, 0, 0);
      const receipt = await tx.wait();
      setStatus(`流动性添加成功，已铸造 ERC721 凭证（tx ${receipt?.hash.slice(0, 10)}…）`);
      bump();
      await load();
    } catch (error) {
      setStatus(`添加失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: PositionInfo) => {
    if (!signer) return;
    setBusy(true);
    setStatus(`销毁 NFT #${row.tokenId} 中…`);
    try {
      const dex = dexContract(row.dexIndex, signer);
      const tx = await dex.removeLiquidity(row.tokenId, 0, 0);
      await tx.wait();
      setStatus(
        `已销毁 NFT #${row.tokenId}，取回 ${fmt(row.redeem0, 4)} ${row.symbol0} + ${fmt(row.redeem1, 4)} ${row.symbol1}`
      );
      bump();
      await load();
    } catch (error) {
      setStatus(`撤销失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="grid two">
        <Card title="添加流动性" subtitle="按当前池子比例注入两种代币，成功后获得一枚 ERC721 流动性凭证">
          <div className="form-row">
            <Field label="交易所 / 交易池">
              <select value={selected} onChange={(event) => setSelected(event.target.value)}>
                {pools.map((item) => (
                  <option key={`${item.dexIndex}-${item.poolId}`} value={`${item.dexIndex}-${item.poolId}`}>
                    {item.dexName} · #{item.poolId} {item.symbol0}/{item.symbol1}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="form-row">
            <Field label={`${pool?.symbol0 ?? "token0"} 数量`}>
              <input value={amount0} onChange={(event) => setAmount0(event.target.value)} inputMode="decimal" />
            </Field>
            <Field label={`${pool?.symbol1 ?? "token1"} 数量`}>
              <input value={amount1} onChange={(event) => setAmount1(event.target.value)} inputMode="decimal" />
            </Field>
          </div>
          {pool && (
            <Notice>
              当前价格 1 {pool.symbol0} = {fmtNum(Number(pool.reserve1) / Math.max(Number(pool.reserve0), 1), 6)}{" "}
              {pool.symbol1}；池子总份额 {fmt(pool.totalShares, 2)}
            </Notice>
          )}
          <div className="button-row">
            <Button onClick={add} disabled={busy || !signer}>
              添加流动性并铸造 NFT
            </Button>
          </div>
          {status && <Notice kind={status.includes("失败") ? "error" : "ok"}>{status}</Notice>}
        </Card>

        <Card title="我的流动性凭证（ERC721）" subtitle="销毁 NFT 即可取回本金与累计的手续费分红">
          {loading ? (
            <Empty>正在读取链上流动性凭证…</Empty>
          ) : mine.length === 0 ? (
            <Empty>当前账户还没有流动性凭证</Empty>
          ) : (
            <div className="nft-grid">
              {mine.map((row) => (
                <div className="nft" key={`${row.dexIndex}-${row.tokenId}`}>
                  <div className="nft-head">
                    <strong>LP #{row.tokenId}</strong>
                    <Badge tone="green">{row.dexName}</Badge>
                  </div>
                  <div className="nft-body">
                    <span>
                      池子 #{row.poolId} {row.symbol0}/{row.symbol1}
                    </span>
                    <span>份额 {fmt(row.shares, 2)}</span>
                    <span className="muted small">创建于 {formatTime(row.createdAt)}</span>
                    <span className="mono">
                      可赎回 {fmt(row.redeem0, 4)} {row.symbol0} + {fmt(row.redeem1, 4)} {row.symbol1}
                    </span>
                  </div>
                  <Button variant="danger" size="sm" disabled={busy} onClick={() => remove(row)}>
                    销毁并取回
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card
        title="流动性来源"
        subtitle="链上所有流动性凭证（最近 40 枚），可以看到每个池子的流动性由谁提供"
        actions={<Badge tone="gray">{all.length} 枚</Badge>}
      >
        {all.length === 0 ? (
          <Empty>{loading ? "加载中…" : "还没有任何流动性凭证"}</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>NFT</th>
                  <th>交易所</th>
                  <th>池子</th>
                  <th>持有者</th>
                  <th>份额</th>
                  <th>创建时间</th>
                  <th>可赎回</th>
                </tr>
              </thead>
              <tbody>
                {all.map((row) => (
                  <tr key={`${row.dexIndex}-${row.tokenId}`}>
                    <td>#{row.tokenId}</td>
                    <td>{row.dexName}</td>
                    <td>
                      #{row.poolId} {row.symbol0}/{row.symbol1}
                    </td>
                    <td className="mono">{shortAddr(row.owner)}</td>
                    <td className="mono">{fmt(row.shares, 2)}</td>
                    <td className="muted small">{formatTime(row.createdAt)}</td>
                    <td className="mono">
                      {fmt(row.redeem0, 3)} / {fmt(row.redeem1, 3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="手续费分红说明" subtitle="为什么销毁 NFT 能拿到分红？">
        <div className="stat-row">
          <Stat label="手续费率" value="0.30%" hint="每笔交易扣 30 bps" />
          <Stat label="分红方式" value="计入储备" hint="reserve 增长 → 每份份额更值钱" />
          <Stat label="赎回公式" value="份额 × 储备 ÷ 总份额" />
        </div>
      </Card>
    </div>
  );
}
