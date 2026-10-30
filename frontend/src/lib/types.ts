import type { JsonRpcSigner } from "ethers";

export type PageProps = {
  account: string;
  signer: JsonRpcSigner | null;
  tick: number;
  bump: () => void;
};
