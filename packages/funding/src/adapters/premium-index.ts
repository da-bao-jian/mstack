// Ported from mobius@33ed2ece funding-server/src/arbitrage/fundingRates.ts
// Aster's market scope and required intervals; Binance uses its documented default.
import { json } from "../http.ts";
import type { FetchContext, ObservedFundingRate } from "../types.ts";
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

export async function premiumIndexRates(
	ctx: FetchContext,
	venue: "aster" | "binance",
	baseUrl: string,
): Promise<ObservedFundingRate[]> {
	const [marks, info] = await Promise.all([
		json(ctx, `${baseUrl}/premiumIndex`),
		json(ctx, `${baseUrl}/fundingInfo`),
	]);
	const intervals = new Map<string, number>();
	for (const value of array(info, "fundingInfo")) {
		const entry = object(value, "fundingInfo row");
		const symbol = string(entry.symbol, "symbol");
		if (intervals.has(symbol))
			throw new Error(`fundingInfo: duplicate ${symbol}`);
		intervals.set(
			symbol,
			positive(entry.fundingIntervalHours, `${symbol} fundingIntervalHours`),
		);
	}
	const rows = array(marks, "premiumIndex").flatMap((value) => {
		const entry = object(value, "premiumIndex row");
		const symbol = string(entry.symbol, "symbol");
		// Binance's dated delivery contracts are outside the perpetual scope.
		if (venue === "binance" && /^[\p{L}\p{N}]+_\d{6}$/u.test(symbol)) return [];
		const ratePerInterval = numeric(
			entry.lastFundingRate,
			`${symbol} lastFundingRate`,
		);
		const markPrice = nonnegative(entry.markPrice, `${symbol} markPrice`);
		const nextFundingAt = timestamp(
			entry.nextFundingTime,
			`${symbol} nextFundingTime`,
		);
		let market = symbol;
		if (venue === "aster") {
			// Match upstream's explicit USDT/USD1 scope; the feed also contains
			// other contracts (e.g. AAPLUSD, ETHU, CDLFORM). Validate them first.
			if (!symbol.endsWith("USDT") && !symbol.endsWith("USD1")) return [];
			const match = /^(.+)(USDT|USD1)$/.exec(symbol);
			if (!match)
				throw new Error(`Unrecognized Aster funding market: ${symbol}`);
			market = match[2] === "USD1" ? `USD1:${match[1]}` : match[1];
		}
		// Binance explicitly defines 8h for symbols absent from its override list.
		const intervalHours =
			intervals.get(symbol) ?? (venue === "binance" ? 8 : undefined);
		if (intervalHours === undefined)
			throw new Error(`Aster published no funding interval for ${symbol}`);
		return [
			rate(ctx, venue, market, ratePerInterval, intervalHours, {
				markPrice,
				...(nextFundingAt === 0 ? {} : { nextFundingAt }),
			}),
		];
	});
	unique(
		rows.map((row) => row.market),
		`${venue} premiumIndex`,
	);
	return rows;
}
