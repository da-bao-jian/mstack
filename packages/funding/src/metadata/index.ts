import { json } from "../http.ts";
import type { FetchContext } from "../types.ts";
import {
	array,
	nonnegative,
	object,
	positive,
	string,
	unique,
} from "../validation.ts";

export interface MarketMetadata {
	venue: string;
	market: string;
	sizeDecimals: number;
	lotSize: number;
	minBase: number;
	minNotionalUsd: number;
	priceDecimals?: number;
	maxLeverage?: number;
	minInitialMarginFraction?: number;
	maintenanceMarginFraction?: number;
}

function decimals(value: unknown, label: string): number {
	const n = nonnegative(value, label);
	if (!Number.isInteger(n) || n > 18)
		throw new Error(`${label}: expected integer in [0,18]`);
	return n;
}
function fraction(value: unknown, label: string): number {
	const n = positive(value, label) / 10_000;
	if (n > 1) throw new Error(`${label}: exceeds 10000`);
	return n;
}

/** Reads the requested HL margin pool; HIP-3 names stay dex-qualified. */
export async function fetchMarketMetadata(
	venue: string,
	market: string,
	ctx: FetchContext,
): Promise<MarketMetadata> {
	let rows: MarketMetadata[];
	if (venue === "hl") {
		const dex = market.includes(":") ? market.split(":")[0] : undefined;
		const body = object(
			await json(ctx, "https://api.hyperliquid.xyz/info", {
				type: "meta",
				...(dex ? { dex } : {}),
			}),
			"HL meta",
		);
		rows = array(body.universe, "HL universe").map((raw) => {
			const row = object(raw, "HL asset");
			const name = string(row.name, "HL name");
			if (dex && !name.startsWith(`${dex}:`))
				throw new Error(`${name}: wrong dex qualifier`);
			const sizeDecimals = decimals(row.szDecimals, `${name} szDecimals`);
			const maxLeverage = positive(row.maxLeverage, `${name} maxLeverage`);
			if (row.isDelisted !== undefined && typeof row.isDelisted !== "boolean")
				throw new Error(`${name}: invalid isDelisted`);
			return {
				venue,
				market: name,
				sizeDecimals,
				lotSize: 10 ** -sizeDecimals,
				minBase: 10 ** -sizeDecimals,
				minNotionalUsd: 10,
				maxLeverage,
				maintenanceMarginFraction: 1 / (2 * maxLeverage),
			};
		});
	} else if (venue === "lighter" || venue === "lighter-mainnet") {
		const host =
			venue === "lighter"
				? "https://api.rh.lighter.xyz"
				: "https://mainnet.zklighter.elliot.ai";
		const body = object(
			await json(ctx, `${host}/api/v1/orderBookDetails`),
			"Lighter details",
		);
		if (body.code !== 200) throw new Error(`Lighter error code ${body.code}`);
		rows = array(body.order_book_details, "order_book_details").flatMap(
			(raw) => {
				const row = object(raw, "Lighter market");
				const name = string(row.symbol, "symbol");
				if (row.status !== "active" && row.status !== "inactive")
					throw new Error(`${name}: invalid market status`);
				if (row.status === "inactive") return [];
				const sizeDecimals = decimals(
					row.size_decimals,
					`${name} size_decimals`,
				);
				const minInitialMarginFraction = fraction(
					row.min_initial_margin_fraction,
					`${name} min_initial_margin_fraction`,
				);
				return [
					{
						venue,
						market: name,
						sizeDecimals,
						lotSize: 10 ** -sizeDecimals,
						minBase: positive(row.min_base_amount, `${name} min_base_amount`),
						minNotionalUsd: positive(
							row.min_quote_amount,
							`${name} min_quote_amount`,
						),
						priceDecimals: decimals(
							row.price_decimals,
							`${name} price_decimals`,
						),
						minInitialMarginFraction,
						maxLeverage: 1 / minInitialMarginFraction,
						maintenanceMarginFraction: fraction(
							row.maintenance_margin_fraction,
							`${name} maintenance_margin_fraction`,
						),
					},
				];
			},
		);
	} else if (venue === "aster") {
		const body = object(
			await json(ctx, "https://fapi.asterdex.com/fapi/v3/exchangeInfo"),
			"Aster exchangeInfo",
		);
		rows = array(body.symbols, "Aster symbols").flatMap((raw) => {
			const row = object(raw, "Aster symbol");
			const quote = string(row.quoteAsset, "quoteAsset");
			if (!["USDT", "USD1"].includes(quote)) return [];
			const base = string(row.baseAsset, "baseAsset");
			const name = quote === "USD1" ? `USD1:${base}` : base;
			const filters = array(row.filters, `${name} filters`).map((f) =>
				object(f, "filter"),
			);
			unique(
				filters.map((f) => string(f.filterType, "filterType")),
				`${name} filters`,
			);
			const lot = filters.find((f) => f.filterType === "LOT_SIZE");
			const notional = filters.find((f) => f.filterType === "MIN_NOTIONAL");
			if (!lot || !notional)
				throw new Error(`${name}: LOT_SIZE and MIN_NOTIONAL required`);
			const lotSize = positive(lot.stepSize, `${name} stepSize`);
			const sizeDecimals = Array.from({ length: 19 }, (_, i) => i).find(
				(i) => Number(lotSize.toFixed(i)) === lotSize,
			);
			if (sizeDecimals === undefined)
				throw new Error(`${name}: unsupported lot precision`);
			return [
				{
					venue,
					market: name,
					sizeDecimals,
					lotSize,
					minBase: positive(lot.minQty, `${name} minQty`),
					minNotionalUsd: positive(notional.notional, `${name} MIN_NOTIONAL`),
				},
			];
		});
	} else throw new Error(`No execution metadata for venue ${venue}`);
	unique(
		rows.map((row) => row.market),
		`${venue} metadata`,
	);
	const result = rows.find((row) => row.market === market);
	if (!result) throw new Error(`${venue}:${market}: metadata missing`);
	return result;
}
