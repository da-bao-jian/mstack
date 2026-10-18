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

/** One public read-only call; the venue allows ten requests per ten seconds. */
const STATS =
	"https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/v2/stats";

export const variational: VenueAdapter = {
	venue: "variational",
	tier: "C",
	async fetchRates(ctx) {
		const body = object(await json(ctx, STATS), "Variational stats");
		const rows = array(body.listings, "Variational listings").flatMap(
			(value) => {
				const entry = object(value, "Variational listing");
				const market = string(entry.ticker, "ticker");
				// Swaps carry separate long and short rates and a daily interval; only
				// perpetuals fit a single funding rate per market.
				if (
					string(entry.contract_type, `${market} contract_type`) !== "perpetual"
				)
					return [];
				// The venue documents a null funding object as "no data available".
				if (entry.funding === null) return [];
				const funding = object(entry.funding, `${market} funding`);
				const next = object(
					funding.next ?? funding.last,
					`${market} funding.next`,
				);
				const oi = object(entry.open_interest, `${market} open_interest`);
				return [
					rate(
						ctx,
						"variational",
						market,
						numeric(next.interval_rate, `${market} interval_rate`),
						positive(funding.interval_seconds, `${market} interval_seconds`) /
							3600,
						{
							nextFundingAt:
								timestamp(funding.next_timestamp, `${market} next_timestamp`) *
								1000,
							markPrice: positive(entry.mark_price, `${market} mark_price`),
							// Trader long and short notional; the liquidity provider holds the other side.
							openInterestUsd:
								nonnegative(
									oi.long_open_interest,
									`${market} long_open_interest`,
								) +
								nonnegative(
									oi.short_open_interest,
									`${market} short_open_interest`,
								),
							volume24hUsd: nonnegative(
								entry.volume_24h,
								`${market} volume_24h`,
							),
						},
					),
				];
			},
		);
		unique(
			rows.map((row) => row.market),
			"Variational listings",
		);
		return rows;
	},
};
