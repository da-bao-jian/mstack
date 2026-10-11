// Ported from mobius@33ed2ece funding-server/src/binding/lighterRequest.ts
import type { ArbitrageVenue } from "../types.ts";
export function lighterPrepareMessage(params: {
	accountIndex: number;
	chainId: number;
	nonce: string;
	timestamp: number;
	venue: ArbitrageVenue | null;
}): string {
	const venueSegment = params.venue === null ? "" : ` venue=${params.venue}`;
	return `Prepare Lighter binding accountIndex=${params.accountIndex} chainId=${params.chainId} nonce=${params.nonce} timestamp=${params.timestamp}${venueSegment}`;
}

/** Wallet authorization for a zero-fee approval using the stored L2 key. */
export function lighterIntegratorApprovalMessage(params: {
	ownerAddress: string;
	venue: ArbitrageVenue;
	integratorIndex: number;
	nonce: string;
	timestamp: number;
}): string {
	return `Approve zero-fee Lighter integrator owner=${params.ownerAddress.toLowerCase()} venue=${params.venue} integratorIndex=${params.integratorIndex} nonce=${params.nonce} timestamp=${params.timestamp}`;
}
