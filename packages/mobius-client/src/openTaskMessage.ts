// Ported from mobius@33ed2ece frontend/src/features/delta-neutral/lib/openTaskMessage.ts
/**
 * Byte-exact mirror of the funding-server open-task message
 * (`funding-server/src/server/routes/arbitrage.ts` `openTaskMessage`).
 *
 * The two builders MUST produce identical strings or the server's ecrecover
 * rejects the signature. The optional `autoClose` segment is appended ONLY when
 * the field is present, so a caller that omits it signs the exact legacy string.
 * New optional segments follow the same rule. A shared test on both sides pins
 * the format.
 */
export function buildOpenTaskMessage(params: {
	longVenue: string;
	longMarket: string;
	shortVenue: string;
	shortMarket: string;
	sizeUsd: number;
	longPrice: number;
	shortPrice: number;
	minFundingApy: number;
	nonce: string;
	timestamp: number;
	autoClose?: boolean;
	longLeverage?: number;
	shortLeverage?: number;
	longMarginMode?: "cross" | "isolated";
	shortMarginMode?: "cross" | "isolated";
	maxSpreadBps?: number;
	liqProtectionPct?: number;
	sizeMismatchPct?: number;
}): string {
	const parts = [
		"Open arbitrage task:",
		`long=${params.longVenue}:${params.longMarket}`,
		`short=${params.shortVenue}:${params.shortMarket}`,
		`sizeUsd=${params.sizeUsd}`,
		`longPrice=${params.longPrice}`,
		`shortPrice=${params.shortPrice}`,
		`minFundingApy=${params.minFundingApy}`,
		`nonce=${params.nonce}`,
		`timestamp=${params.timestamp}`,
	];
	if (params.autoClose !== undefined) {
		parts.push(`autoClose=${params.autoClose ? "on" : "off"}`);
	}
	if (params.longLeverage !== undefined) {
		parts.push(`longLeverage=${params.longLeverage}`);
	}
	if (params.shortLeverage !== undefined) {
		parts.push(`shortLeverage=${params.shortLeverage}`);
	}
	if (params.longMarginMode !== undefined) {
		parts.push(`longMarginMode=${params.longMarginMode}`);
	}
	if (params.shortMarginMode !== undefined) {
		parts.push(`shortMarginMode=${params.shortMarginMode}`);
	}
	if (params.maxSpreadBps !== undefined) {
		parts.push(`maxSpreadBps=${params.maxSpreadBps}`);
	}
	if (params.liqProtectionPct !== undefined) {
		parts.push(`liqProtectionPct=${params.liqProtectionPct}`);
	}
	if (params.sizeMismatchPct !== undefined) {
		parts.push(`sizeMismatchPct=${params.sizeMismatchPct}`);
	}
	return parts.join(" ");
}
