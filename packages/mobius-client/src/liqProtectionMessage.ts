// Ported from mobius@33ed2ece frontend/src/features/delta-neutral/lib/liqProtectionMessage.ts
/**
 * Byte-exact mirror of the funding-server liquidation-protection message
 * (`funding-server/src/server/routes/arbitrage.ts` `liqProtectionTaskMessage`).
 *
 * The two builders MUST produce identical strings or the server's ecrecover
 * recovers a different address and the request 400s with "invalid signature"
 * and no clue why. Tests on both sides pin the exact bytes.
 *
 * `null` turns protection off and is spelled `off`, not `0` or `null`: the
 * server's bound is `(0, 100]`, so a `0` would be indistinguishable from a
 * threshold it would have rejected, and `null` says nothing to someone reading
 * the prompt in their wallet.
 */
export function buildLiqProtectionMessage(params: {
	taskId: string;
	timestamp: number;
	liqProtectionPct: number | null;
}): string {
	return `Set arbitrage liquidation protection: ${params.taskId} liqProtectionPct=${params.liqProtectionPct ?? "off"} timestamp=${params.timestamp}`;
}
