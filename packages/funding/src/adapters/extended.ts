import { json } from "../http.ts";
import type { VenueAdapter } from "../types.ts";
import {
	array,
	nonnegative,
	numeric,
	object,
	positive,
	rate,
	string,
	timestamp,
	unique,
} from "../validation.ts";

/**
 * Extended (Starknet) settles funding every hour. Market stats carry the
 * hourly rate as a fraction, the mark, open interest and daily volume in USD,
 * and the next settlement time (named `nextFundingRate`). Only ACTIVE
 * perpetuals emit rows; the venue labels each market Crypto or RWA.
 */
export const extended: VenueAdapter = {
	venue: "extended",
	tier: "C",
	async fetchRates(ctx) {
		const body = object(
			await json(
				ctx,
				"https://api.starknet.extended.exchange/api/v1/info/markets",
			),
			"Extended markets",
		);
		if (body.status !== "OK")
			throw new Error(`Extended status ${String(body.status)}`);
		const rows = array(body.data, "Extended data").flatMap((value) => {
			const entry = object(value, "Extended market");
			const market = string(entry.name, "name");
			// Spot markets share the list; only active perpetuals carry funding.
			if (entry.type !== "PERPETUAL") return [];
			if (string(entry.status, `${market} status`) !== "ACTIVE") return [];
			const stats = object(entry.marketStats, `${market} marketStats`);
			const markPrice = positive(stats.markPrice, `${market} markPrice`);
			return [
				rate(
					ctx,
					"extended",
					market,
					numeric(stats.fundingRate, `${market} fundingRate`),
					1,
					{
						markPrice,
						openInterestUsd: nonnegative(
							stats.openInterest,
							`${market} openInterest`,
						),
						volume24hUsd: nonnegative(
							stats.dailyVolume,
							`${market} dailyVolume`,
						),
						nextFundingAt: timestamp(
							stats.nextFundingRate,
							`${market} nextFundingRate`,
						),
						venueCategory: entry.category === "RWA" ? "rwa" : "crypto",
					},
				),
			];
		});
		unique(
			rows.map((row) => row.market),
			"Extended markets",
		);
		return rows;
	},
};
