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

const CONTRACTS = "https://api.qfex.com/md/contracts";

export const qfex: VenueAdapter = {
	venue: "qfex",
	tier: "C",
	async fetchRates(ctx) {
		const body = object(await json(ctx, CONTRACTS), "QFEX contracts");
		const rows = array(body.data, "QFEX data").flatMap((value) => {
			const entry = object(value, "QFEX contract");
			const market = string(entry.ticker_id, "ticker_id");
			if (string(entry.product_type, `${market} product_type`) !== "Perpetual")
				throw new Error(`${market}: expected Perpetual`);
			// A few contracts quote in KRW, CNY, JPY, or SEK; those are not USD legs.
			if (string(entry.target_currency, `${market} target_currency`) !== "USD")
				return [];
			// The feed publishes no mark price, so entry cost stays unmeasured.
			return [
				rate(
					ctx,
					"qfex",
					market,
					// QFEX documents the rate as the premium in basis points divided
					// by 100, so the published value is a percentage per hour.
					numeric(entry.next_funding_rate, `${market} next_funding_rate`) / 100,
					positive(
						entry.funding_interval_minutes,
						`${market} funding_interval_minutes`,
					) / 60,
					{
						nextFundingAt:
							timestamp(
								entry.next_funding_rate_timestamp,
								`${market} next_funding_rate_timestamp`,
							) * 1000,
						openInterestUsd: nonnegative(
							entry.open_interest_usd,
							`${market} open_interest_usd`,
						),
						volume24hUsd: nonnegative(
							entry.target_volume,
							`${market} target_volume`,
						),
					},
				),
			];
		});
		unique(
			rows.map((row) => row.market),
			"QFEX contracts",
		);
		return rows;
	},
};
