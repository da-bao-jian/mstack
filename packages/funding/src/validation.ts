import { annualizePeriodicFundingPct } from "./index.ts";
import type { FetchContext, ObservedFundingRate } from "./types.ts";

export function object(value: unknown, label: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label}: expected object`);
	}
	return value as Record<string, unknown>;
}

export function array(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`${label}: expected array`);
	return value;
}

export function string(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`${label}: expected nonempty string`);
	}
	return value;
}

export function numeric(value: unknown, label: string): number {
	if (
		typeof value !== "number" &&
		(typeof value !== "string" ||
			!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(value))
	) {
		throw new Error(`${label}: expected finite number`);
	}
	const result = Number(value);
	if (!Number.isFinite(result))
		throw new Error(`${label}: expected finite number`);
	return result;
}

export function positive(value: unknown, label: string): number {
	const result = numeric(value, label);
	if (result <= 0) throw new Error(`${label}: must be positive`);
	return result;
}

export function nonnegative(value: unknown, label: string): number {
	const result = numeric(value, label);
	if (result < 0) throw new Error(`${label}: must be nonnegative`);
	return result;
}

export function timestamp(value: unknown, label: string): number {
	const result = nonnegative(value, label);
	if (!Number.isSafeInteger(result))
		throw new Error(`${label}: invalid timestamp`);
	return result;
}

/** Absence stays unknown; present but malformed volume fails the adapter. */
export function volume(
	value: unknown,
	label: string,
): { volume24hUsd?: number } {
	return value === undefined ? {} : { volume24hUsd: nonnegative(value, label) };
}

export function unique(values: string[], label: string): void {
	if (new Set(values).size !== values.length)
		throw new Error(`${label}: duplicate market`);
}

export function rate(
	ctx: FetchContext,
	venue: string,
	market: string,
	ratePerInterval: number,
	intervalHours: number,
	extras: Partial<
		Pick<
			ObservedFundingRate,
			| "nextFundingAt"
			| "markPrice"
			| "openInterestUsd"
			| "volume24hUsd"
			| "priceChange24hPct"
			| "oiCapped"
			| "venueCategory"
			| "source"
		>
	> = {},
): ObservedFundingRate {
	const annualizedPct = annualizePeriodicFundingPct(
		ratePerInterval,
		intervalHours,
	);
	if (annualizedPct === null || !Number.isFinite(annualizedPct)) {
		throw new Error(`${venue}:${market}: invalid funding rate or interval`);
	}
	return {
		venue,
		market,
		ratePerInterval,
		intervalHours,
		annualizedPct,
		observedAt: timestamp(ctx.now(), "observedAt"),
		source: "direct",
		annualizationMethod: "simple",
		...extras,
	};
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
