import type { JsonRpcSigner } from "ethers";

export type TabKey =
  | "overview"
  | "faucet"
  | "pools"
  | "trade"
  | "liquidity"
  | "simulation"
  | "arbitrage";

export type PageProps = {
  account: string;
  signer: JsonRpcSigner | null;
  tick: number;
  bump: () => void;
  navigate: (tab: TabKey) => void;
};
