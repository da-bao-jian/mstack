// Ported from mobius@33ed2ece hl-sdk/esm/api/exchange/_methods/{approveAgent,approveBuilderFee}.js
// Hyperliquid SDK v0.33.2: user-signed actions only; no SDK runtime dependency.
import type { Hex, TypedDataDefinition } from "viem";

export const ApproveAgentTypes = {
  "HyperliquidTransaction:ApproveAgent": [
    { name: "hyperliquidChain", type: "string" },
    { name: "agentAddress", type: "address" },
    { name: "agentName", type: "string" },
    { name: "nonce", type: "uint64" },
  ],
} as const;
export const ApproveBuilderFeeTypes = {
  "HyperliquidTransaction:ApproveBuilderFee": [
    { name: "hyperliquidChain", type: "string" },
    { name: "maxFeeRate", type: "string" },
    { name: "builder", type: "address" },
    { name: "nonce", type: "uint64" },
  ],
} as const;
// Ported from mobius@33ed2ece hl-sdk/esm/signing/_userSigned.js
export function hlTypedAction(action: Record<string, string | number>): TypedDataDefinition {
  const types = action.type === "approveAgent" ? ApproveAgentTypes : ApproveBuilderFeeTypes;
  if (action.type !== "approveAgent" && action.type !== "approveBuilderFee") throw new Error("Unsupported HL action");
  return {
    domain: {
      name: "HyperliquidSignTransaction", version: "1",
      chainId: parseInt(String(action.signatureChainId)),
      verifyingContract: "0x0000000000000000000000000000000000000000",
    },
    types, primaryType: Object.keys(types)[0], message: action,
  } as TypedDataDefinition;
}
// Ported from mobius@33ed2ece hl-sdk/esm/signing/_abstractWallet.js
export function splitHlSignature(hex: Hex) {
  if (hex.length !== 132) throw new Error(`Expected 65-byte signature (132 hex chars), got ${hex.length}`);
  const r = `0x${hex.slice(2, 66)}`;
  const s = `0x${hex.slice(66, 130)}`;
  let v = parseInt(hex.slice(130, 132), 16);
  if (v === 0 || v === 1) v += 27;
  if (v !== 27 && v !== 28) throw new Error(`Invalid signature recovery value: ${v}, expected 0/1 or 27/28`);
  return { r, s, v };
}
