import { json } from "../http.ts";
import type { ObservedFundingRate, VenueAdapter } from "../types.ts";
import {
	array,
	nonnegative,
	numeric,
	object,
	positive,
	rate,
	string,
	unique,
} from "../validation.ts";

const BASE = "https://market-data.grvt.io/full/v1";
/** Tickers are served one instrument per request; this bounds the fan-out. */
const CONCURRENCY = 16;

/** GRVT timestamps are nanoseconds as decimal strings beyond 2^53. */
function nanosToMillis(value: unknown, label: string): number {
	if (typeof value !== "string" || !/^\d{16,}$/.test(value))
		throw new Error(`${label}: invalid timestamp`);
	return Number(value.slice(0, -6));
}

async function mapLimit<T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (next < items.length) {
				const index = next++;
				results[index] = await fn(items[index] as T);
			}
		}),
	);
	return results;
}

export const grvt: VenueAdapter = {
	venue: "grvt",
	tier: "C",
	async fetchRates(ctx) {
		const listing = object(
			await json(ctx, `${BASE}/all_instruments`, {
				kind: ["PERPETUAL"],
				is_active: true,
			}),
			"GRVT instruments",
		);
		const instruments = array(listing.result, "GRVT result").flatMap(
			(value) => {
				const entry = object(value, "GRVT instrument");
				const market = string(entry.instrument, "instrument");
				if (string(entry.kind, `${market} kind`) !== "PERPETUAL")
					throw new Error(`${market}: expected PERPETUAL`);
				if (string(entry.status, `${market} status`) !== "ACTIVE") return [];
				return [
					{
						market,
						intervalHours: positive(
							entry.funding_interval_hours,
							`${market} funding_interval_hours`,
						),
					},
				];
			},
		);
		unique(
			instruments.map((entry) => entry.market),
			"GRVT instruments",
		);
		return mapLimit(
			instruments,
			CONCURRENCY,
			async ({ market, intervalHours }): Promise<ObservedFundingRate> => {
				const ticker = object(
					object(
						await json(ctx, `${BASE}/ticker`, { instrument: market }),
						"GRVT ticker",
					).result,
					`${market} ticker result`,
				);
				if (ticker.instrument !== market)
					throw new Error(
						`${market}: ticker names ${String(ticker.instrument)}`,
					);
				const markPrice = positive(ticker.mark_price, `${market} mark_price`);
				// The ticker quotes an eight-hour rate in percentage points for
				// every instrument; the payment per settlement scales with the
				// instrument's own interval, so the hourly rate is unchanged.
				const rate8h =
					numeric(
						ticker.funding_rate_8h_curr,
						`${market} funding_rate_8h_curr`,
					) / 100;
				return rate(
					ctx,
					"grvt",
					market,
					(rate8h * intervalHours) / 8,
					intervalHours,
					{
						nextFundingAt: nanosToMillis(
							ticker.next_funding_time,
							`${market} next_funding_time`,
						),
						markPrice,
						openInterestUsd:
							nonnegative(ticker.open_interest, `${market} open_interest`) *
							markPrice,
						volume24hUsd:
							nonnegative(
								ticker.buy_volume_24h_q,
								`${market} buy_volume_24h_q`,
							) +
							nonnegative(
								ticker.sell_volume_24h_q,
								`${market} sell_volume_24h_q`,
							),
					},
				);
			},
		);
	},
};
