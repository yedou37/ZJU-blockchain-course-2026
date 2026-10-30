import { useCallback, useEffect, useState } from "react";
import type { JsonRpcSigner } from "ethers";
import "./App.css";
import { DEXES, fmt, getEthBalance, listAccounts, provider, shortAddr } from "./lib/chain";
import Faucet from "./pages/Faucet";
import Pools from "./pages/Pools";
import Trade from "./pages/Trade";
import Liquidity from "./pages/Liquidity";
import Simulation from "./pages/Simulation";
import Arbitrage from "./pages/Arbitrage";

type TabKey = "faucet" | "pools" | "trade" | "liquidity" | "simulation" | "arbitrage";

const TABS: { key: TabKey; label: string; desc: string }[] = [
  { key: "faucet", label: "水龙头", desc: "领取测试代币与 ETH" },
  { key: "pools", label: "交易池", desc: "创建 / 查看 AMM 池" },
  { key: "trade", label: "兑换", desc: "恒定乘积 swap" },
  { key: "liquidity", label: "流动性", desc: "ERC721 凭证与分红" },
  { key: "simulation", label: "模拟交易", desc: "20 用户随机操作" },
  { key: "arbitrage", label: "套利", desc: "跨交易所原子套利" },
];

function App() {
  const [accounts, setAccounts] = useState<string[]>([]);
  const [account, setAccount] = useState("");
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [tab, setTab] = useState<TabKey>("faucet");
  const [tick, setTick] = useState(0);
  const [eth, setEth] = useState(0n);
  const [error, setError] = useState("");

  const bump = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    listAccounts()
      .then((list) => {
        setAccounts(list);
        setAccount((previous) => previous || list[0] || "");
        setError("");
      })
      .catch(() => setError("无法连接本地节点，请先在 contracts/ 目录运行 npm run node 与 npm run deploy"));
  }, []);

  useEffect(() => {
    if (!account) return;
    let alive = true;
    provider
      .getSigner(account)
      .then((value) => alive && setSigner(value))
      .catch(() => alive && setSigner(null));
    getEthBalance(account)
      .then((value) => alive && setEth(value))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [account, tick]);

  // 每 4 秒自动刷新一次链上数据，方便演示
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 4000);
    return () => clearInterval(timer);
  }, []);

  const pageProps = { account, signer, tick, bump };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◈</span>
          <div>
            <h1>MiniDEX · AMM 去中心化交易所</h1>
            <p className="muted small">
              Uniswap V2 风格 · 恒定乘积做市 · ERC721 流动性凭证 · 双交易所原子套利
            </p>
          </div>
        </div>
        <div className="wallet">
          <select value={account} onChange={(event) => setAccount(event.target.value)}>
            {accounts.map((address, index) => (
              <option key={address} value={address}>
                用户 {String(index + 1).padStart(2, "0")} · {shortAddr(address)}
              </option>
            ))}
          </select>
          <div className="balance">
            <span className="muted small">ETH</span>
            <strong>{fmt(eth, 3)}</strong>
          </div>
          <button className="btn ghost sm" onClick={bump}>
            刷新
          </button>
        </div>
      </header>

      {error && <div className="notice error">{error}</div>}

      <nav className="tabs">
        {TABS.map((item) => (
          <button
            key={item.key}
            className={`tab ${tab === item.key ? "active" : ""}`}
            onClick={() => setTab(item.key)}
          >
            <span className="tab-label">{item.label}</span>
            <span className="tab-desc">{item.desc}</span>
          </button>
        ))}
      </nav>

      <main className="content">
        {tab === "faucet" && <Faucet {...pageProps} />}
        {tab === "pools" && <Pools {...pageProps} />}
        {tab === "trade" && <Trade {...pageProps} />}
        {tab === "liquidity" && <Liquidity {...pageProps} />}
        {tab === "simulation" && <Simulation {...pageProps} />}
        {tab === "arbitrage" && <Arbitrage {...pageProps} />}
      </main>

      <footer className="footer">
        <span>
          当前账户：<code>{account || "-"}</code>
        </span>
        <span>
          交易所：{DEXES.map((dex) => `${dex.name} ${shortAddr(dex.address)}`).join(" · ")}
        </span>
      </footer>
    </div>
  );
}

export default App;
