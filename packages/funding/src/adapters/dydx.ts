import { json } from "../http.ts";
import type { VenueAdapter } from "../types.ts";
import {
	nonnegative,
	numeric,
	object,
	positive,
	rate,
	string,
} from "../validation.ts";

/**
 * dYdX v4 settles funding every hour. The indexer's `nextFundingRate` is the
 * estimated hourly rate as a fraction; the oracle price stands in for the
 * mark. Open interest is in base units and 24-hour volume in USD. Markets in
 * final settlement emit no rows.
 */
export const dydx: VenueAdapter = {
	venue: "dydx",
	tier: "C",
	async fetchRates(ctx) {
		const body = object(
			await json(ctx, "https://indexer.dydx.trade/v4/perpetualMarkets"),
			"dYdX perpetualMarkets",
		);
		const markets = object(body.markets, "dYdX markets");
		return Object.entries(markets).flatMap(([key, value]) => {
			const entry = object(value, `dYdX ${key}`);
			const market = string(entry.ticker, `${key} ticker`);
			if (market !== key)
				throw new Error(`dYdX market key ${key} != ${market}`);
			if (string(entry.status, `${market} status`) !== "ACTIVE") return [];
			const markPrice = positive(entry.oraclePrice, `${market} oraclePrice`);
			const change = numeric(entry.priceChange24H, `${market} priceChange24H`);
			return [
				rate(
					ctx,
					"dydx",
					market,
					numeric(entry.nextFundingRate, `${market} nextFundingRate`),
					1,
					{
						markPrice,
						openInterestUsd:
							nonnegative(entry.openInterest, `${market} openInterest`) *
							markPrice,
						volume24hUsd: nonnegative(entry.volume24H, `${market} volume24H`),
						...(markPrice - change > 0
							? { priceChange24hPct: (change / (markPrice - change)) * 100 }
							: {}),
					},
				),
			];
		});
	},
};
