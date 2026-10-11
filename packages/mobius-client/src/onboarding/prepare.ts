// Ported from mobius@33ed2ece frontend/src/features/binding/api.ts
/** The prepare authorization, before any venue key approval. */
export function bindingPrepareMessage(
	venue: "hl" | "aster",
	params: { nonce: string; timestamp: number },
): string {
	return `Prepare ${venue === "hl" ? "HL" : "Aster"} binding nonce=${params.nonce} timestamp=${params.timestamp}`;
}
