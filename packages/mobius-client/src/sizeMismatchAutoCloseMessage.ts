// Ported from mobius@33ed2ece frontend/src/features/delta-neutral/lib/sizeMismatchAutoCloseMessage.ts
/**
 * The smallest threshold the server will accept, mirroring
 * `MIN_SIZE_MISMATCH_PCT` in `funding-server/src/arbitrage/sizeMismatch.ts`.
 *
 * It is the band inside which liquidation protection considers a trim to have
 * SQUARED the pair. A threshold under it makes the two rules contradict each
 * other: protection reports the legs as repaired, which lifts its own
 * suppression, and the same gap then reads as a breach and closes the position.
 * The server refuses such a value, so this exists to say so on the form rather
 * than after a signature.
 */
export const MIN_SIZE_MISMATCH_PCT = 0.5;

export function buildSizeMismatchAutoCloseMessage(params: {
	taskId: string;
	enabled: boolean;
	thresholdPct: number;
	timestamp: number;
}): string {
	return `Set size mismatch auto-close: ${params.taskId} enabled=${params.enabled ? "on" : "off"} thresholdPct=${params.thresholdPct} timestamp=${params.timestamp}`;
}
