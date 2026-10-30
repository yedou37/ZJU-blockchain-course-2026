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

const TOKEN_COLORS: Record<string, string> = {
  TKA: "#2f6bff",
  TKB: "#e8722b",
  TKC: "#0a8f5b",
  WETH: "#8b5cf6",
};

const pairGradient = (a: string, b: string) =>
  `linear-gradient(135deg, ${TOKEN_COLORS[a] ?? "#64748b"}, ${TOKEN_COLORS[b] ?? "#94a3b8"})`;

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
          amount0AtMint: row.amount0AtMint,
          amount1AtMint: row.amount1AtMint,
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
    setAll(allRows.sort((a, b) => b.tokenId - a.tokenId).slice(0, 20));
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

  const estimatedShares =
    pool && pool.totalShares > 0n && pool.reserve0 > 0n
      ? (parseAmount(amount0) * pool.totalShares) / pool.reserve0
      : null;

  const feeEarned = (row: PositionInfo) => {
    const delta0 = row.redeem0 > row.amount0AtMint ? row.redeem0 - row.amount0AtMint : 0n;
    const delta1 = row.redeem1 > row.amount1AtMint ? row.redeem1 - row.amount1AtMint : 0n;
    return { delta0, delta1 };
  };

  const feeText = (row: PositionInfo) => {
    const { delta0, delta1 } = feeEarned(row);
    const parts: string[] = [];
    if (delta0 > 0n) parts.push(`+${fmt(delta0, 4)} ${row.symbol0}`);
    if (delta1 > 0n) parts.push(`+${fmt(delta1, 4)} ${row.symbol1}`);
    return parts.length > 0 ? parts.join(" · ") : "—";
  };

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

  const totalFees = mine.reduce(
    (acc, row) => {
      const { delta0, delta1 } = feeEarned(row);
      return { delta0: acc.delta0 + delta0, delta1: acc.delta1 + delta1 };
    },
    { delta0: 0n, delta1: 0n }
  );

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
            <div className="stat-row">
              <Stat
                label="当前价格"
                value={`${fmtNum(Number(pool.reserve1) / Math.max(Number(pool.reserve0), 1), 6)} ${pool.symbol1}`}
                hint={`1 ${pool.symbol0}`}
              />
              <Stat label="池子总份额" value={fmt(pool.totalShares, 2)} />
              <Stat
                label="预计获得份额"
                value={estimatedShares === null ? "首次注资" : fmt(estimatedShares, 2)}
                hint={estimatedShares === null ? "份额 = √(x·y)" : "按现有储备占比"}
              />
            </div>
          )}
          <div className="button-row">
            <Button onClick={add} disabled={busy || !signer}>
              添加流动性并铸造 NFT
            </Button>
          </div>
          {status && <Notice kind={status.includes("失败") ? "error" : "ok"}>{status}</Notice>}
        </Card>

        <Card
          title="我的流动性凭证"
          subtitle="ERC721 NFT 记录池子、份额与时间，销毁即可赎回本金 + 手续费分红"
          actions={<Badge tone="green">{mine.length} 枚</Badge>}
        >
          <div className="stat-row">
            <Stat label="持有 NFT" value={mine.length} />
            <Stat label="累计手续费" value={`+${fmt(totalFees.delta0, 2)}`} hint="token0 侧" />
            <Stat label="累计手续费" value={`+${fmt(totalFees.delta1, 2)}`} hint="token1 侧" />
          </div>

          {loading ? (
            <Empty>正在读取链上流动性凭证…</Empty>
          ) : mine.length === 0 ? (
            <Empty>当前账户还没有流动性凭证，先在上方添加流动性</Empty>
          ) : (
            <div className="nft-grid">
              {mine.map((row) => (
                <article className="nft" key={`${row.dexIndex}-${row.tokenId}`}>
                  <div className="nft-cover" style={{ background: pairGradient(row.symbol0, row.symbol1) }}>
                      <span className="nft-pair">
                        {row.symbol0}/{row.symbol1}
                      </span>
                      <span className="nft-id">LP #{row.tokenId}</span>
                    </div>
                    <div className="nft-body">
                      <div className="nft-row">
                        <span className="muted small">交易所 / 池子</span>
                        <span>
                          {row.dexName} · #{row.poolId}
                        </span>
                      </div>
                      <div className="nft-row">
                        <span className="muted small">份额</span>
                        <span className="mono">{fmt(row.shares, 2)}</span>
                      </div>
                      <div className="nft-row">
                        <span className="muted small">创建时间</span>
                        <span className="muted small">{formatTime(row.createdAt)}</span>
                      </div>
                      <div className="nft-row">
                        <span className="muted small">可赎回</span>
                        <span className="mono">
                          {fmt(row.redeem0, 3)} {row.symbol0} + {fmt(row.redeem1, 3)} {row.symbol1}
                        </span>
                      </div>
                      <div className="nft-row">
                        <span className="muted small">手续费收益</span>
                        <span className="mono up">{feeText(row)}</span>
                      </div>
                    </div>
                    <Button variant="danger" size="sm" disabled={busy} onClick={() => remove(row)}>
                      销毁并取回
                    </Button>
                  </article>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card
        title="流动性来源"
        subtitle="链上所有流动性凭证（最近 20 枚），可以看到每个池子的流动性由谁提供"
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
                  <th>建仓</th>
                  <th>可赎回</th>
                  <th>手续费收益</th>
                  <th>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {all.map((row) => {
                  const { delta0, delta1 } = feeEarned(row);
                  const hasFee = delta0 > 0n || delta1 > 0n;
                  return (
                    <tr key={`${row.dexIndex}-${row.tokenId}`}>
                      <td>#{row.tokenId}</td>
                      <td>{row.dexName}</td>
                      <td>
                        #{row.poolId} {row.symbol0}/{row.symbol1}
                      </td>
                      <td className="mono">{shortAddr(row.owner)}</td>
                      <td className="mono">{fmt(row.shares, 2)}</td>
                      <td className="mono small">
                        {fmt(row.amount0AtMint, 1)} / {fmt(row.amount1AtMint, 1)}
                      </td>
                      <td className="mono">
                        {fmt(row.redeem0, 2)} / {fmt(row.redeem1, 2)}
                      </td>
                      <td className={`mono ${hasFee ? "up" : "muted"}`}>
                        {hasFee ? `+${fmt(delta0, 2)} / +${fmt(delta1, 2)}` : "—"}
                      </td>
                      <td className="muted small">{formatTime(row.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="手续费分红是怎么算的？" subtitle="不需要额外的「领取分红」交易，销毁 NFT 时自动结算">
        <div className="stat-row four">
          <Stat label="手续费率" value="0.30%" hint="每笔交易扣 30 bps" />
          <Stat label="分红方式" value="计入储备" hint="reserve 增长 → 每份份额更值钱" />
          <Stat label="赎回公式" value="份额 × 储备 ÷ 总份额" />
          <Stat label="销毁" value="_burn(tokenId)" hint="NFT 销毁后无法再次赎回" />
        </div>
      </Card>
    </div>
  );
}
