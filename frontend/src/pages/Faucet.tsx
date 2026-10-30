import { useCallback, useEffect, useState } from "react";
import {
  TOKENS,
  WETH,
  errorText,
  faucetContract,
  fmt,
  getEthBalance,
  tokenContract,
  wethContract,
} from "../lib/chain";
import type { PageProps } from "../lib/types";
import { Badge, Button, Card, Notice } from "../components/UI";

const TOKEN_COLORS: Record<string, string> = {
  TKA: "#2f6bff",
  TKB: "#e8722b",
  TKC: "#0a8f5b",
  WETH: "#8b5cf6",
};

type Balance = { symbol: string; value: bigint; cooldown: bigint };

export default function Faucet({ account, signer, tick, bump }: PageProps) {
  const [balances, setBalances] = useState<Balance[]>([]);
  const [eth, setEth] = useState<bigint>(0n);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!account) return;
    const list: Balance[] = [];
    for (const token of TOKENS) {
      const contract = tokenContract(token.address);
      const [value, cooldown] = await Promise.all([
        contract.balanceOf(account),
        contract.faucetCooldownLeft(account),
      ]);
      list.push({ symbol: token.symbol, value, cooldown });
    }
    list.push({ symbol: "WETH", value: await wethContract().balanceOf(account), cooldown: 0n });
    setBalances(list);
    setEth(await getEthBalance(account));
  }, [account]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load, tick]);

  const run = async (label: string, action: () => Promise<any>) => {
    if (!signer) return;
    setBusy(true);
    setStatus(`${label} 提交中…`);
    try {
      const tx = await action();
      await tx.wait();
      setStatus(`${label} 成功`);
      bump();
      await load();
    } catch (error) {
      setStatus(`${label} 失败：${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const claimAll = async () => {
    if (!signer) return;
    setBusy(true);
    const done: string[] = [];
    for (const token of TOKENS) {
      try {
        setStatus(`领取 ${token.symbol}…`);
        await (await tokenContract(token.address, signer).claim()).wait();
        done.push(token.symbol);
      } catch {
        /* 冷却中，跳过 */
      }
    }
    try {
      setStatus("领取测试 ETH…");
      await (await faucetContract(signer).claimETH()).wait();
      done.push("1 ETH");
    } catch {
      /* 冷却中，跳过 */
    }
    setStatus(done.length > 0 ? `已领取：${done.join("、")}` : "全部代币都在冷却中，请稍后再试");
    setBusy(false);
    bump();
    await load();
  };

  return (
    <div className="grid two">
      <Card
        title="测试水龙头"
        subtitle="每个地址每小时可领取一次：1000 TKA / TKB / TKC 与 1 ETH，方便模拟多个用户"
        actions={<Badge tone="gray">{TOKENS.length + 1} 种资产</Badge>}
      >
        <div className="token-grid">
          {balances.map((item) => (
            <div className="token-card" key={item.symbol}>
              <div className="token-head">
                <span className="token-dot" style={{ background: TOKEN_COLORS[item.symbol] ?? "#94a3b8" }} />
                <span>{item.symbol}</span>
              </div>
              <strong className="token-value">{fmt(item.value, 2)}</strong>
              <span className="muted small">
                {item.symbol === "WETH"
                  ? "ETH 包装而来"
                  : item.cooldown > 0n
                    ? `冷却 ${Math.ceil(Number(item.cooldown) / 60)} 分钟`
                    : "可领取"}
              </span>
            </div>
          ))}
        </div>

        <div className="button-row">
          <Button onClick={claimAll} disabled={busy || !signer}>
            一键领取全部
          </Button>
          {TOKENS.map((token) => (
            <Button
              key={token.symbol}
              variant="ghost"
              size="sm"
              disabled={busy || !signer}
              onClick={() =>
                run(`领取 ${token.symbol}`, () => tokenContract(token.address, signer!).claim())
              }
            >
              {token.symbol}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || !signer}
            onClick={() => run("领取 1 ETH", () => faucetContract(signer!).claimETH())}
          >
            1 ETH
          </Button>
        </div>

        {status && <Notice kind={status.includes("失败") ? "error" : "ok"}>{status}</Notice>}
      </Card>

      <Card title="ETH ⇄ WETH" subtitle="AMM 统一用 ERC20 接口处理资产，交易 ETH 交易对前先包装成 WETH">
        <div className="swap-box">
          <div className="swap-side">
            <span className="muted small">可用</span>
            <strong>{fmt(eth, 3)} ETH</strong>
          </div>
          <span className="swap-arrow">⇄</span>
          <div className="swap-side">
            <span className="muted small">WETH 余额</span>
            <strong>{fmt(balances.find((item) => item.symbol === "WETH")?.value ?? 0n, 3)}</strong>
          </div>
        </div>
        <div className="button-row">
          <Button
            disabled={busy || !signer}
            onClick={() =>
              run("包装 1 ETH", () => wethContract(signer!).deposit({ value: 10n ** 18n }))
            }
          >
            1 ETH → WETH
          </Button>
          <Button
            variant="ghost"
            disabled={busy || !signer}
            onClick={() => run("赎回 1 WETH", () => wethContract(signer!).withdraw(10n ** 18n))}
          >
            1 WETH → ETH
          </Button>
        </div>
        <Notice>
          WETH 合约：<code>{WETH.address}</code>
          <br />
          当前账户：<code>{account}</code>
        </Notice>
      </Card>
    </div>
  );
}
