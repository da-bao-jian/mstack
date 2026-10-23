import {
	type FundingHistory,
	fetchFundingHistory,
	HISTORY_VENUES,
} from "@mstack/funding";
import type { Runtime } from "./runtime.ts";

// What a pair actually earned: the settled funding of the short leg minus the
// long leg, averaged per hour over the last 1, 7 and 30 days, annualized.
// One 30-day history read per leg serves all three windows.

export interface Realized {
	/** Simple annualized percent; null when a leg has no settlement in the window. */
	d1: number | null;
	d7: number | null;
	d30: number | null;
	/** Why the pair has no history, when it has none. */
	reason?: string;
}

const HOUR = 3_600_000;
const WINDOWS = { d1: 24, d7: 168, d30: 720 } as const;

function average(history: FundingHistory, since: number): number | null {
	const samples = history.samples.filter((sample) => sample.time > since);
	const hours = samples.reduce((sum, sample) => sum + sample.intervalHours, 0);
	return hours
		? samples.reduce((sum, sample) => sum + sample.ratePerInterval, 0) / hours
		: null;
}

type Leg = { venue: string; market: string };

/** Realized spreads for pairs, reading each leg once, four reads at a time. */
export async function realizedSpreads(
	pairs: readonly { long: Leg; short: Leg }[],
	rt: Runtime,
): Promise<Map<string, Realized>> {
	const endTime = rt.now();
	const startTime = endTime - WINDOWS.d30 * HOUR;
	const legs = new Map<string, Leg>();
	for (const pair of pairs)
		for (const leg of [pair.long, pair.short])
			if (HISTORY_VENUES.includes(leg.venue))
				legs.set(`${leg.venue}:${leg.market}`, leg);
	const histories = new Map<string, FundingHistory | Error>();
	const queue = [...legs];
	await Promise.all(
		Array.from({ length: Math.min(4, queue.length) }, async () => {
			for (let next = queue.shift(); next; next = queue.shift()) {
				const [key, leg] = next;
				try {
					histories.set(
						key,
						await fetchFundingHistory(leg.venue, leg.market, {
							startTime,
							endTime,
							fetch: rt.fetch,
							now: rt.now,
						}),
					);
				} catch (error) {
					histories.set(
						key,
						error instanceof Error ? error : new Error(String(error)),
					);
				}
			}
		}),
	);
	const result = new Map<string, Realized>();
	for (const pair of pairs) {
		const key = `${pair.long.venue}:${pair.long.market}>${pair.short.venue}:${pair.short.market}`;
		const long = histories.get(`${pair.long.venue}:${pair.long.market}`);
		const short = histories.get(`${pair.short.venue}:${pair.short.market}`);
		const missing = [pair.long, pair.short].find(
			(leg) => !HISTORY_VENUES.includes(leg.venue),
		);
		if (
			missing ||
			!long ||
			!short ||
			long instanceof Error ||
			short instanceof Error
		) {
			result.set(key, {
				d1: null,
				d7: null,
				d30: null,
				reason: missing
					? `${missing.venue} has no keyless history`
					: (((long instanceof Error ? long : short) as Error | undefined)
							?.message ?? "history unavailable"),
			});
			continue;
		}
		const spread = (hours: number) => {
			const since = endTime - hours * HOUR;
			const a = average(long, since);
			const b = average(short, since);
			return a === null || b === null ? null : (b - a) * 8760 * 100;
		};
		result.set(key, {
			d1: spread(WINDOWS.d1),
			d7: spread(WINDOWS.d7),
			d30: spread(WINDOWS.d30),
		});
	}
	return result;
}

export function pairKey(pair: { long: Leg; short: Leg }): string {
	return `${pair.long.venue}:${pair.long.market}>${pair.short.venue}:${pair.short.market}`;
}
