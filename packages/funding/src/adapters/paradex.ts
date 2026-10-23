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
	unique,
} from "../validation.ts";

/**
 * Paradex perpetuals from the all-markets summary; options and perpetual
 * options are skipped. `funding_rate` covers `funding_interval_minutes`, open
 * interest is in base units, and 24-hour volume is in USD.
 */
export const paradex: VenueAdapter = {
	venue: "paradex",
	tier: "C",
	async fetchRates(ctx) {
		const body = object(
			await json(
				ctx,
				"https://api.prod.paradex.trade/v1/markets/summary?market=ALL",
			),
			"Paradex summary",
		);
		const rows = array(body.results, "Paradex results").flatMap((value) => {
			const entry = object(value, "Paradex market");
			const market = string(entry.symbol, "symbol");
			if (!market.endsWith("-PERP")) return [];
			const markPrice = positive(entry.mark_price, `${market} mark_price`);
			return [
				rate(
					ctx,
					"paradex",
					market,
					numeric(entry.funding_rate, `${market} funding_rate`),
					positive(
						entry.funding_interval_minutes,
						`${market} funding_interval_minutes`,
					) / 60,
					{
						markPrice,
						openInterestUsd:
							nonnegative(entry.open_interest, `${market} open_interest`) *
							markPrice,
						volume24hUsd: nonnegative(entry.volume_24h, `${market} volume_24h`),
						priceChange24hPct:
							numeric(
								entry.price_change_rate_24h,
								`${market} price_change_rate_24h`,
							) * 100,
					},
				),
			];
		});
		unique(
			rows.map((row) => row.market),
			"Paradex summary",
		);
		return rows;
	},
};
