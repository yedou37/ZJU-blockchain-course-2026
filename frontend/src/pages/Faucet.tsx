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
import { Button, Card, Notice, Stat } from "../components/UI";

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
    const weth = wethContract();
    list.push({ symbol: "WETH", value: await weth.balanceOf(account), cooldown: 0n });
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

  return (
    <div className="grid two">
      <Card
        title="测试水龙头"
        subtitle="每个地址每小时可领取一次：1000 TKA / TKB / TKC 与 1 ETH，方便模拟多个用户"
      >
        <div className="stat-row">
          {balances.map((item) => (
            <Stat key={item.symbol} label={`${item.symbol} 余额`} value={fmt(item.value, 2)} />
          ))}
          <Stat label="ETH 余额" value={fmt(eth, 3)} />
        </div>

        <div className="button-row">
          {TOKENS.map((token) => (
            <Button
              key={token.symbol}
              disabled={busy || !signer}
              onClick={() =>
                run(`领取 ${token.symbol}`, () => tokenContract(token.address, signer!).claim())
              }
            >
              领取 {token.symbol}
            </Button>
          ))}
          <Button
            variant="ghost"
            disabled={busy || !signer}
            onClick={() => run("领取 1 ETH", () => faucetContract(signer!).claimETH())}
          >
            领取 1 ETH
          </Button>
        </div>

        {balances.some((item) => item.cooldown > 0n) && (
          <Notice>
            冷却中：
            {balances
              .filter((item) => item.cooldown > 0n)
              .map((item) => `${item.symbol} 还需 ${Number(item.cooldown)} 秒`)
              .join("，")}
          </Notice>
        )}

        {status && <Notice kind={status.includes("失败") ? "error" : "ok"}>{status}</Notice>}
      </Card>

      <Card title="ETH ⇄ WETH" subtitle="AMM 用统一的 ERC20 接口处理 ETH 交易对，交易前先把 ETH 包装成 WETH">
        <p className="muted">
          当前账户：<code>{account}</code>
        </p>
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
          WETH 合约地址：<code>{WETH.address}</code>
        </Notice>
      </Card>
    </div>
  );
}
