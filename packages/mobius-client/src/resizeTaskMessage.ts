// Ported from mobius@33ed2ece frontend/src/features/delta-neutral/lib/resizeTaskMessage.ts
/**
 * Byte-exact mirror of the funding-server resize message
 * (`funding-server/src/server/routes/arbitrage.ts` `resizeTaskMessage`).
 *
 * The two builders MUST produce identical strings or the server's ecrecover
 * recovers a different address and the request 400s with "invalid signature"
 * and no clue why. A leg target is appended ONLY when present — a single-leg
 * resize omits one, and the two shapes must be distinguishable without either
 * needing a placeholder. Tests on both sides pin the exact bytes.
 *
 * Targets are BASE quantities and are interpolated with default number
 * stringification, so the caller must hand over a value that round-trips —
 * round each target to that venue's own size precision before signing rather
 * than passing raw float arithmetic.
 */
export function buildResizeTaskMessage(params: {
	taskId: string;
	timestamp: number;
	longTargetBase?: number;
	shortTargetBase?: number;
	disableSizeMismatchAutoClose?: boolean;
}): string {
	const parts = [
		"Resize arbitrage task:",
		params.taskId,
		`timestamp=${params.timestamp}`,
	];
	if (params.longTargetBase !== undefined) {
		parts.push(`longTarget=${params.longTargetBase}`);
	}
	if (params.shortTargetBase !== undefined) {
		parts.push(`shortTarget=${params.shortTargetBase}`);
	}
	if (params.disableSizeMismatchAutoClose === true) {
		parts.push("disableSizeMismatchAutoClose=on");
	}
	return parts.join(" ");
}
