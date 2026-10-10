import {
	aster,
	binance,
	bybit,
	type Fetch,
	fetchSnapshot,
	hyperliquid,
	lighter,
	lighterMainnet,
	okx,
	type Snapshot,
} from "@mobstack/funding";
import { UsageError } from "../config.ts";

export interface Runtime {
	fetch: Fetch;
	now: () => number;
	home: string;
}

const adapters = [
	hyperliquid,
	lighter,
	lighterMainnet,
	aster,
	binance,
	bybit,
	okx,
];
const SNAPSHOT_TIMEOUT_MS = 30_000;

export function commandError(error: unknown): string {
	return `mob: ${error instanceof Error ? error.message : String(error)}`;
}

export function selectedVenues(names?: readonly string[]) {
	if (names === undefined) return adapters;
	if (
		!names.length ||
		names.some((name) => !adapters.some((adapter) => adapter.venue === name)) ||
		new Set(names).size !== names.length
	)
		throw new UsageError(`Invalid venues: ${names.join(",")}`);
	return names.map(
		(name) =>
			adapters.find(
				(adapter) => adapter.venue === name,
			) as (typeof adapters)[number],
	);
}

export function base(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(value))
		throw new UsageError("market must be a base ticker");
	return value.toUpperCase();
}

export function snapshot(
	venues: ReturnType<typeof selectedVenues>,
	rt: Runtime,
) {
	return fetchSnapshot(venues, {
		timeoutMs: SNAPSHOT_TIMEOUT_MS,
		fetch: rt.fetch,
		now: rt.now,
	});
}

// CLI exit 2 distinguishes zero rates from healthy rates with zero matching pairs.
// This private, non-enumerable metadata leaves the public JSON contract unchanged.
const rateCount = Symbol("snapshotRateCount");
export function withRateCount<T extends { failed: Snapshot["failed"] }>(
	data: T,
	rates: number,
): T & { readonly [rateCount]: number } {
	return Object.defineProperty(data, rateCount, { value: rates }) as T & {
		readonly [rateCount]: number;
	};
}

export function exitFor(
	data: { failed: Snapshot["failed"]; readonly [rateCount]: number },
	strict: boolean,
): number {
	if (!data[rateCount]) return 2;
	return strict && data.failed.length > 0 ? 3 : 0;
}
