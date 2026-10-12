import { annualizePeriodicFundingPct } from "./index.ts";
import type {
	Fetch,
	ObservedFundingRate,
	Snapshot,
	VenueAdapter,
	VenueFailure,
} from "./types.ts";
import { errorMessage, nonnegative, string, timestamp } from "./validation.ts";

export interface SnapshotOptions {
	timeoutMs: number;
	fetch?: Fetch;
	now?: () => number;
}

function validateRows(rows: ObservedFundingRate[]): void {
	if (!Array.isArray(rows)) throw new Error("Adapter did not return an array");
	for (const row of rows) {
		if (!row || typeof row !== "object") throw new Error("Invalid adapter row");
		string(row.venue, "venue");
		string(row.market, "market");
		const annualized = annualizePeriodicFundingPct(
			row.ratePerInterval,
			row.intervalHours,
		);
		if (
			annualized === null ||
			!Number.isFinite(annualized) ||
			row.annualizedPct !== annualized
		) {
			throw new Error(`${row.venue}:${row.market}: invalid funding math`);
		}
		timestamp(row.observedAt, "observedAt");
		if (row.volume24hUsd !== undefined)
			nonnegative(row.volume24hUsd, "volume24hUsd");
		if (
			row.priceChange24hPct !== undefined &&
			!Number.isFinite(row.priceChange24hPct)
		)
			throw new Error("priceChange24hPct: expected finite number");
		if (
			row.annualizationMethod !== "simple" ||
			!["direct", "hosted"].includes(row.source)
		) {
			throw new Error(
				`${row.venue}:${row.market}: invalid source or annualization method`,
			);
		}
	}
}

export async function fetchSnapshot(
	adapters: readonly VenueAdapter[],
	options: SnapshotOptions,
): Promise<Snapshot> {
	if (
		!Number.isInteger(options.timeoutMs) ||
		options.timeoutMs <= 0 ||
		options.timeoutMs > 2_147_483_647
	) {
		throw new Error(
			"timeoutMs must be a positive integer no greater than 2147483647",
		);
	}
	const now = options.now ?? Date.now;
	const results = await Promise.all(
		adapters.map(async (adapter) => {
			const controller = new AbortController();
			const deadline = performance.now() + options.timeoutMs;
			const failures: VenueFailure[] = [];
			let active = true;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const timeout = new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					const error = new Error(`Timed out after ${options.timeoutMs}ms`);
					controller.abort(error);
					reject(error);
				}, options.timeoutMs);
			});
			try {
				const rows = await Promise.race([
					Promise.resolve().then(() =>
						adapter.fetchRates({
							fetch: options.fetch ?? globalThis.fetch,
							signal: controller.signal,
							now,
							deadline,
							reportFailure: (failure) => {
								if (active) failures.push(failure);
							},
						}),
					),
					timeout,
				]);
				validateRows(rows);
				return { rows, failures };
			} catch (error) {
				failures.push({ venue: adapter.venue, error: errorMessage(error) });
				return { rows: [], failures };
			} finally {
				active = false;
				clearTimeout(timer);
				controller.abort();
			}
		}),
	);
	const rates = results.flatMap((result) => result.rows);
	return {
		observedAt: timestamp(now(), "snapshot observedAt"),
		rates,
		listed: [...new Set(rates.map((row) => `${row.venue}:${row.market}`))],
		failed: results.flatMap((result) => result.failures),
		source: "direct",
		annualizationMethod: "simple",
	};
}
