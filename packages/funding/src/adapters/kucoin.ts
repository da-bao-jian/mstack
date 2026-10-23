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
 * KuCoin USDT- and USDC-settled perpetuals; inverse contracts are skipped.
 * `fundingFeeRate` covers `fundingRateGranularity` milliseconds. Open interest
 * is in contracts of `multiplier` base units; `turnoverOf24h` is USD volume.
 */
export const kucoin: VenueAdapter = {
	venue: "kucoin",
	tier: "C",
	async fetchRates(ctx) {
		const body = object(
			await json(ctx, "https://api-futures.kucoin.com/api/v1/contracts/active"),
			"KuCoin contracts",
		);
		if (body.code !== "200000")
			throw new Error(`KuCoin error code ${String(body.code)}`);
		const rows = array(body.data, "KuCoin data").flatMap((value) => {
			const entry = object(value, "KuCoin contract");
			const market = string(entry.symbol, "symbol");
			if (
				entry.type !== "FFWCSX" ||
				entry.status !== "Open" ||
				entry.isInverse !== false
			)
				return [];
			const markPrice = positive(entry.markPrice, `${market} markPrice`);
			return [
				rate(
					ctx,
					"kucoin",
					market,
					numeric(entry.fundingFeeRate, `${market} fundingFeeRate`),
					positive(
						entry.fundingRateGranularity,
						`${market} fundingRateGranularity`,
					) / 3_600_000,
					{
						markPrice,
						nextFundingAt: timestamp(
							entry.nextFundingRateDateTime,
							`${market} nextFundingRateDateTime`,
						),
						openInterestUsd:
							nonnegative(entry.openInterest, `${market} openInterest`) *
							positive(entry.multiplier, `${market} multiplier`) *
							markPrice,
						volume24hUsd: nonnegative(
							entry.turnoverOf24h,
							`${market} turnoverOf24h`,
						),
					},
				),
			];
		});
		unique(
			rows.map((row) => row.market),
			"KuCoin contracts",
		);
		return rows;
	},
};
