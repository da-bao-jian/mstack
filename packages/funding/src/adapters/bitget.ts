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

/** USDT-margined perpetuals; USDC and coin-margined products are separate feeds. */
const BASE = "https://api.bitget.com/api/v2/mix/market";
const PRODUCT = "productType=USDT-FUTURES";

function data(value: unknown, label: string): unknown[] {
	const body = object(value, label);
	if (body.code !== "00000")
		throw new Error(`${label}: error code ${String(body.code)}`);
	return array(body.data, `${label} data`);
}

export const bitget: VenueAdapter = {
	venue: "bitget",
	tier: "C",
	async fetchRates(ctx) {
		const [rawContracts, rawTickers] = await Promise.all([
			json(ctx, `${BASE}/contracts?${PRODUCT}`),
			json(ctx, `${BASE}/tickers?${PRODUCT}`),
		]);
		const tickers = new Map<string, Record<string, unknown>>();
		for (const value of data(rawTickers, "Bitget tickers")) {
			const entry = object(value, "Bitget ticker");
			const market = string(entry.symbol, "symbol");
			if (tickers.has(market))
				throw new Error(`Duplicate Bitget ticker ${market}`);
			tickers.set(market, entry);
		}
		const contracts = data(rawContracts, "Bitget contracts").map((value) => {
			const entry = object(value, "Bitget contract");
			const market = string(entry.symbol, "symbol");
			return {
				market,
				live:
					string(entry.symbolType, `${market} symbolType`) === "perpetual" &&
					string(entry.symbolStatus, `${market} symbolStatus`) === "normal",
				intervalHours: positive(entry.fundInterval, `${market} fundInterval`),
				// isRwa labels real-world assets without naming their category.
				rwa:
					entry.isRwa === "YES"
						? true
						: entry.isRwa === "NO"
							? false
							: undefined,
			};
		});
		unique(
			contracts.map((entry) => entry.market),
			"Bitget contracts",
		);
		// The next settlement time is only served per symbol, so it stays unknown.
		return contracts
			.filter((entry) => entry.live)
			.map(({ market, intervalHours, rwa }) => {
				const ticker = tickers.get(market);
				if (!ticker) throw new Error(`${market}: missing Bitget ticker row`);
				const markPrice = positive(ticker.markPrice, `${market} markPrice`);
				return rate(
					ctx,
					"bitget",
					market,
					numeric(ticker.fundingRate, `${market} fundingRate`),
					intervalHours,
					{
						markPrice,
						openInterestUsd:
							nonnegative(ticker.holdingAmount, `${market} holdingAmount`) *
							markPrice,
						volume24hUsd: nonnegative(
							ticker.usdtVolume,
							`${market} usdtVolume`,
						),
						priceChange24hPct:
							numeric(ticker.change24h, `${market} change24h`) * 100,
						...(rwa === undefined
							? {}
							: {
									venueCategory: rwa ? ("rwa" as const) : ("crypto" as const),
								}),
					},
				);
			});
	},
};
