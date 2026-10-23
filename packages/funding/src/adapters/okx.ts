import { json } from "../http.ts";
import type {
	ObservedFundingRate,
	VenueAdapter,
	VenueCategory,
} from "../types.ts";
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

// OKX instCategory: 1 crypto, 3 stocks, 4 commodities. Other codes stay unlabeled.
const CATEGORIES: Readonly<Record<string, VenueCategory>> = {
	"1": "crypto",
	"3": "stock",
	"4": "commodity",
};

function data(value: unknown): unknown[] {
	const body = object(value, "OKX response");
	if (body.code !== "0") throw new Error(`OKX error code ${body.code}`);
	return array(body.data, "OKX data");
}

export function createOkxAdapter(): VenueAdapter {
	return {
		venue: "okx",
		tier: "C",
		async fetchRates(ctx) {
			const [rawInstruments, rawFunding, rawMarks, rawTickers] =
				await Promise.all([
					json(
						ctx,
						"https://www.okx.com/api/v5/public/instruments?instType=SWAP",
					),
					json(
						ctx,
						"https://www.okx.com/api/v5/public/funding-rate?instId=ANY",
					),
					json(
						ctx,
						"https://www.okx.com/api/v5/public/mark-price?instType=SWAP",
					),
					json(ctx, "https://www.okx.com/api/v5/market/tickers?instType=SWAP"),
				]);
			const tickers = new Map<
				string,
				{ volume?: number; priceChange24hPct?: number }
			>();
			for (const value of data(rawTickers)) {
				const entry = object(value, "OKX ticker");
				const market = string(entry.instId, "instId");
				if (entry.instType !== "SWAP")
					throw new Error(`${market}: expected SWAP ticker`);
				if (tickers.has(market))
					throw new Error(`Duplicate OKX ticker ${market}`);
				// A newly listed swap with no trade yet sends empty last and open
				// prices: its price change is unknown, not malformed.
				const untraded = entry.last === "" && entry.open24h === "";
				tickers.set(market, {
					...(entry.volCcy24h === undefined
						? {}
						: { volume: nonnegative(entry.volCcy24h, `${market} volCcy24h`) }),
					...(untraded
						? {}
						: {
								priceChange24hPct:
									((positive(entry.last, `${market} last`) -
										positive(entry.open24h, `${market} open24h`)) /
										positive(entry.open24h, `${market} open24h`)) *
									100,
							}),
				});
			}
			const marks = new Map<string, number>();
			for (const value of data(rawMarks)) {
				const entry = object(value, "OKX mark price");
				const market = string(entry.instId, "instId");
				if (entry.instType !== "SWAP")
					throw new Error(`${market}: expected SWAP mark`);
				if (marks.has(market)) throw new Error(`Duplicate OKX mark ${market}`);
				marks.set(market, positive(entry.markPx, `${market} markPx`));
			}
			const instruments = data(rawInstruments).map((value) => {
				const entry = object(value, "OKX instrument");
				const market = string(entry.instId, "instId");
				if (entry.instType !== "SWAP")
					throw new Error(`${market}: expected SWAP`);
				return {
					market,
					state: string(entry.state, `${market} state`),
					category:
						typeof entry.instCategory === "string"
							? CATEGORIES[entry.instCategory]
							: undefined,
				};
			});
			unique(
				instruments.map((entry) => entry.market),
				"OKX instruments",
			);
			const live = new Set(
				instruments
					.filter((entry) => entry.state === "live")
					.map((entry) => entry.market),
			);
			const categories = new Map(
				instruments.map((entry) => [entry.market, entry.category]),
			);
			const rates = new Map<string, ObservedFundingRate>();
			const seen = new Set<string>();
			for (const value of data(rawFunding)) {
				const entry = object(value, "OKX funding rate");
				const market = string(entry.instId, "instId");
				if (seen.has(market))
					throw new Error(`OKX funding: duplicate ${market}`);
				seen.add(market);
				if (!live.has(market)) continue;
				const markPrice = marks.get(market);
				if (markPrice === undefined)
					throw new Error(`${market}: missing live mark row`);
				if (entry.instType !== "SWAP")
					throw new Error(`${market}: expected SWAP funding`);
				const fundingTime = timestamp(
					entry.fundingTime,
					`${market} fundingTime`,
				);
				const nextFundingTime = timestamp(
					entry.nextFundingTime,
					`${market} nextFundingTime`,
				);
				const intervalHours = positive(
					(nextFundingTime - fundingTime) / 3_600_000,
					`${market} intervalHours`,
				);
				rates.set(
					market,
					rate(
						ctx,
						"okx",
						market,
						numeric(entry.fundingRate, `${market} fundingRate`),
						intervalHours,
						{
							nextFundingAt: fundingTime,
							markPrice,
							...(categories.get(market) === undefined
								? {}
								: { venueCategory: categories.get(market) }),
							...(tickers.get(market)?.volume === undefined
								? {}
								: {
										volume24hUsd: nonnegative(
											(tickers.get(market)?.volume as number) * markPrice,
											`${market} volume24hUsd`,
										),
									}),
							...(tickers.get(market)?.priceChange24hPct === undefined
								? {}
								: {
										priceChange24hPct: tickers.get(market)?.priceChange24hPct,
									}),
						},
					),
				);
			}
			return [...live].map((market) => {
				const row = rates.get(market);
				if (!row) throw new Error(`${market}: missing live funding row`);
				return row;
			});
		},
	};
}

export const okx = createOkxAdapter();
