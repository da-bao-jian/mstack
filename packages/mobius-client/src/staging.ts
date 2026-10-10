import { buildOpenTaskMessage } from "./openTaskMessage.ts";
import type { OpenBody } from "./types.ts";

/** Call only with venue marks observed at staging. Nothing is refreshed at sign time. */
export function stageOpenBody(
	input: Omit<OpenBody, "nonce" | "timestamp" | "minFundingApy"> & {
		minFundingApy?: number;
	},
	now = Date.now(),
) {
	const body: OpenBody = {
		...input,
		minFundingApy: input.minFundingApy ?? 0,
		nonce: crypto.randomUUID(),
		timestamp: Math.floor(now / 1000),
	};
	for (const key of Object.keys(body) as (keyof OpenBody)[])
		if (body[key] === undefined) delete body[key];
	for (const key of ["sizeUsd", "longPrice", "shortPrice"] as const)
		if (!Number.isFinite(body[key]) || body[key] <= 0)
			throw new Error(`${key} must be positive`);
	if (!Number.isFinite(body.minFundingApy) || body.minFundingApy < 0)
		throw new Error("minFundingApy must be nonnegative");
	// Venue verification and leverage steps belong to W10; never claim them here.
	for (const key of [
		"longLeverage",
		"shortLeverage",
		"longMarginMode",
		"shortMarginMode",
	] as const)
		if (body[key] !== undefined)
			throw new Error(`${key} requires venue verification (W10)`);
	return { body, message: buildOpenTaskMessage(body) };
}
