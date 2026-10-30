import { Contract, JsonRpcProvider, formatUnits, parseUnits, type JsonRpcSigner } from "ethers";
import deployment from "./deployments.json";

/** 本地 Hardhat 节点的 RPC 地址（部署脚本会把它写进 deployments.json） */
export const RPC_URL: string = (deployment as any).rpcUrl ?? "http://127.0.0.1:8545";

export const provider = new JsonRpcProvider(RPC_URL);

export const TOKENS: { symbol: string; name: string; address: string; decimals: number }[] = (
  deployment as any
).tokens;
export const WETH = (deployment as any).weth as { address: string; symbol: string; decimals: number };
export const FAUCET: string = (deployment as any).faucet;
export const ARBITRAGE: string = (deployment as any).arbitrage;
export const DEXES: { key: string; name: string; address: string; pools: any[] }[] = (deployment as any).dexes;
export const ABIS: Record<string, any[]> = (deployment as any).abis;

export const SYMBOLS: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const token of TOKENS) map[token.address.toLowerCase()] = token.symbol;
  map[WETH.address.toLowerCase()] = WETH.symbol;
  return map;
})();

export type PoolInfo = {
  dexIndex: number;
  dexName: string;
  poolId: number;
  token0: string;
  token1: string;
  symbol0: string;
  symbol1: string;
  reserve0: bigint;
  reserve1: bigint;
  totalShares: bigint;
  feeBps: bigint;
  createdAt: bigint;
  swapCount: bigint;
};

export type PositionInfo = {
  dexIndex: number;
  dexName: string;
  tokenId: number;
  poolId: number;
  shares: bigint;
  createdAt: bigint;
  owner: string;
  amount0AtMint: bigint;
  amount1AtMint: bigint;
  redeem0: bigint;
  redeem1: bigint;
  symbol0: string;
  symbol1: string;
};

export function dexContract(index: number, signer?: JsonRpcSigner) {
  return new Contract(DEXES[index].address, ABIS.MiniDEX, signer ?? provider);
}

export function tokenContract(address: string, signer?: JsonRpcSigner) {
  return new Contract(address, ABIS.MockERC20, signer ?? provider);
}

export function wethContract(signer?: JsonRpcSigner) {
  return new Contract(WETH.address, ABIS.MockWETH, signer ?? provider);
}

export function faucetContract(signer?: JsonRpcSigner) {
  return new Contract(FAUCET, ABIS.Faucet, signer ?? provider);
}

export function arbitrageContract(signer?: JsonRpcSigner) {
  return new Contract(ARBITRAGE, ABIS.Arbitrage, signer ?? provider);
}

export async function listAccounts(): Promise<string[]> {
  const signers = await provider.listAccounts();
  return signers.map((signer) => signer.address);
}

export async function getEthBalance(address: string): Promise<bigint> {
  return provider.getBalance(address);
}

export function symbolOf(address: string): string {
  return SYMBOLS[address.toLowerCase()] ?? "?";
}

/** 读取两个交易所里的所有交易池 */
export async function loadPools(): Promise<PoolInfo[]> {
  const result: PoolInfo[] = [];
  for (let dexIndex = 0; dexIndex < DEXES.length; dexIndex++) {
    const dex = dexContract(dexIndex);
    const pools = await dex.getPools();
    pools.forEach((pool: any, index: number) => {
      result.push({
        dexIndex,
        dexName: DEXES[dexIndex].name,
        poolId: Number(pool.poolId ?? index + 1),
        token0: pool.token0,
        token1: pool.token1,
        symbol0: symbolOf(pool.token0),
        symbol1: symbolOf(pool.token1),
        reserve0: pool.reserve0,
        reserve1: pool.reserve1,
        totalShares: pool.totalShares,
        feeBps: pool.feeBps,
        createdAt: pool.createdAt,
        swapCount: pool.swapCount,
      });
    });
  }
  return result;
}

export const fmt = (value: bigint, digits = 4): string => {
  const raw = formatUnits(value, 18);
  const [intPart, decPart = ""] = raw.split(".");
  const decimals = decPart.slice(0, digits).replace(/0+$/, "");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decimals ? `${grouped}.${decimals}` : grouped;
};

export const fmtNum = (value: number, digits = 4): string => {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: digits });
  return value.toFixed(digits);
};

export const parseAmount = (value: string): bigint => {
  try {
    if (!value || Number(value) === 0) return 0n;
    return parseUnits(value, 18);
  } catch {
    return 0n;
  }
};

export const shortAddr = (address?: string): string =>
  address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";

/** 1 个 token0 值多少个 token1 */
export const price0In1 = (pool: { reserve0: bigint; reserve1: bigint }): number => {
  if (pool.reserve0 === 0n) return 0;
  return Number(pool.reserve1) / Number(pool.reserve0);
};

export const formatTime = (timestamp: bigint): string => {
  const date = new Date(Number(timestamp) * 1000);
  return date.toLocaleString("zh-CN", { hour12: false });
};

/** 池子价格文案：没有储备时显示占位符，避免出现 0.000000 的误导 */
export const poolPriceText = (pool: {
  reserve0: bigint;
  reserve1: bigint;
  symbol0: string;
  symbol1: string;
}): string =>
  pool.reserve0 === 0n ? "—" : `1 ${pool.symbol0} = ${fmtNum(price0In1(pool), 6)} ${pool.symbol1}`;

export const errorText = (error: unknown): string => {
  const message = (error as any)?.shortMessage ?? (error as any)?.message ?? String(error);
  return message.split("\n")[0].slice(0, 160);
};
