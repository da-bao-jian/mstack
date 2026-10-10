import { json } from "../http.ts";
import { annualizePeriodicFundingPct } from "../index.ts";
import type { Fetch, FetchContext } from "../types.ts";
import {
	array,
	numeric,
	object,
	positive,
	string,
	timestamp,
} from "../validation.ts";

export interface HistorySample {
	time: number;
	ratePerInterval: number;
	intervalHours: number;
}

export interface FundingHistory {
	venue: string;
	market: string;
	samples: HistorySample[];
	sampleCount: number;
	hoursCovered: number;
	averageRatePerHour: number | null;
	annualizedPct: number | null;
	minRatePerHour: number | null;
	maxRatePerHour: number | null;
	startTime: number;
	endTime: number;
	observedAt: number;
	source: "direct";
	annualizationMethod: "simple";
}

export interface HistoryOptions {
	startTime: number;
	endTime: number;
	timeoutMs?: number;
	fetch?: Fetch;
	now?: () => number;
}

type Point = { time: number; rate: number };

function points(raw: unknown, venue: string, symbol: string): Point[] {
	let rows: unknown[];
	if (venue === "bybit") {
		const body = object(raw, "Bybit history");
		if (body.retCode !== 0)
			throw new Error(`Bybit history error ${body.retCode}`);
		rows = array(object(body.result, "result").list, "history list");
	} else if (venue === "okx") {
		const body = object(raw, "OKX history");
		if (body.code !== "0") throw new Error(`OKX history error ${body.code}`);
		rows = array(body.data, "history data");
	} else rows = array(raw, "funding history");
	return rows.map((value) => {
		const row = object(value, "history row");
		const name = string(
			row[venue === "hl" ? "coin" : venue === "okx" ? "instId" : "symbol"],
			"history market",
		);
		if (name !== symbol)
			throw new Error(`History market mismatch: ${name} != ${symbol}`);
		return {
			time: timestamp(
				row[
					venue === "hl"
						? "time"
						: venue === "bybit"
							? "fundingRateTimestamp"
							: "fundingTime"
				],
				"funding time",
			),
			rate: numeric(
				row[venue === "okx" ? "realizedRate" : "fundingRate"],
				"historical funding rate",
			),
		};
	});
}

function endpoint(
	venue: string,
	symbol: string,
	params: Record<string, number>,
): string {
	const base =
		venue === "binance"
			? "https://fapi.binance.com/fapi/v1/fundingRate"
			: venue === "aster"
				? "https://fapi.asterdex.com/fapi/v3/fundingRate"
				: venue === "bybit"
					? "https://api.bybit.com/v5/market/funding/history"
					: "https://www.okx.com/api/v5/public/funding-rate-history";
	const url = new URL(base);
	if (venue === "bybit") url.searchParams.set("category", "linear");
	url.searchParams.set(venue === "okx" ? "instId" : "symbol", symbol);
	for (const [key, value] of Object.entries(params))
		url.searchParams.set(key, String(value));
	return url.href;
}

async function readHistory(
	ctx: FetchContext,
	venue: string,
	market: string,
	start: number,
	end: number,
): Promise<Point[]> {
	const symbol =
		venue === "aster"
			? market.startsWith("USD1:")
				? `${market.slice(5)}USD1`
				: `${market}USDT`
			: market;
	const result: Point[] = [];
	const seen = new Set<number>();
	const add = (rows: Point[]) => {
		for (const row of rows) {
			if (seen.has(row.time))
				throw new Error(`Duplicate history settlement ${row.time}`);
			seen.add(row.time);
			result.push(row);
		}
	};
	if (venue === "hl") {
		let cursor = start;
		while (cursor <= end) {
			const rows = points(
				await json(ctx, "https://api.hyperliquid.xyz/info", {
					type: "fundingHistory",
					coin: symbol,
					startTime: cursor,
					endTime: end,
				}),
				venue,
				symbol,
			);
			if (rows.length === 0) break;
			if (rows.some((row) => row.time < cursor || row.time > end))
				throw new Error("HL history outside requested window");
			add(rows);
			cursor = Math.max(...rows.map((r) => r.time)) + 1;
		}
	} else if (venue === "binance" || venue === "aster") {
		// Fetch a day of boundary context, then use the nearest preceding row.
		// Aster endTime-only queries can return the oldest listing settlement.
		// No predecessor in this bounded context is an error, never a guessed interval.
		let cursor = Math.max(1, start - 86_400_000);
		while (cursor <= end) {
			const rows = points(
				await json(
					ctx,
					endpoint(venue, symbol, {
						startTime: cursor,
						endTime: end,
						limit: 1000,
					}),
				),
				venue,
				symbol,
			);
			if (rows.some((row) => row.time < cursor || row.time > end))
				throw new Error("History outside requested window");
			add(rows);
			if (rows.length < 1000) break;
			cursor = Math.max(...rows.map((r) => r.time)) + 1;
		}
	} else if (venue === "bybit") {
		const before = points(
			await json(
				ctx,
				endpoint(venue, symbol, { endTime: start - 1, limit: 1 }),
			),
			venue,
			symbol,
		);
		if (before.length > 1 || before.some((row) => row.time >= start))
			throw new Error("Invalid history boundary response");
		add(before);
		let cursor = end;
		while (cursor >= start) {
			const rows = points(
				await json(
					ctx,
					endpoint(venue, symbol, {
						startTime: start,
						endTime: cursor,
						limit: 200,
					}),
				),
				venue,
				symbol,
			);
			if (rows.some((row) => row.time < start || row.time > cursor))
				throw new Error("Bybit history outside requested window");
			add(rows);
			if (rows.length < 200) break;
			cursor = Math.min(...rows.map((r) => r.time)) - 1;
		}
	} else {
		let cursor: number | undefined;
		while (true) {
			const rows = points(
				await json(
					ctx,
					endpoint(venue, symbol, {
						limit: 100,
						...(cursor === undefined ? {} : { after: cursor }),
					}),
				),
				venue,
				symbol,
			);
			const previousCursor = cursor;
			if (
				previousCursor !== undefined &&
				rows.some((row) => row.time >= previousCursor)
			)
				throw new Error("OKX history cursor did not advance");
			add(rows);
			if (rows.length === 0) break;
			cursor = Math.min(...rows.map((r) => r.time));
			if (cursor < start || rows.length < 100) break;
		}
	}
	return result.sort((a, b) => a.time - b.time);
}

export async function fetchFundingHistory(
	venue: string,
	market: string,
	options: HistoryOptions,
): Promise<FundingHistory> {
	if (!["hl", "binance", "aster", "bybit", "okx"].includes(venue))
		throw new Error(`${venue}: no keyless history`);
	string(market, "history market");
	const startTime = timestamp(options.startTime, "startTime");
	const endTime = timestamp(options.endTime, "endTime");
	if (startTime < 1 || endTime <= startTime)
		throw new Error("History requires 0 < startTime < endTime");
	const timeoutMs = positive(options.timeoutMs ?? 30_000, "timeoutMs");
	if (!Number.isInteger(timeoutMs) || timeoutMs > 2_147_483_647)
		throw new Error("Invalid history timeoutMs");
	const now = options.now ?? Date.now;
	const ctx: FetchContext = {
		fetch: options.fetch ?? globalThis.fetch,
		signal: AbortSignal.timeout(timeoutMs),
		now,
		reportFailure: () => {},
	};
	const rows = await readHistory(ctx, venue, market, startTime, endTime);
	const samples: HistorySample[] = [];
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		if (row.time < startTime || row.time > endTime) continue;
		if (venue !== "hl" && i === 0)
			throw new Error(
				`${venue}:${market}: no preceding settlement to measure the first interval`,
			);
		samples.push({
			time: row.time,
			ratePerInterval: row.rate,
			intervalHours:
				venue === "hl"
					? 1
					: positive(
							(row.time - rows[i - 1].time) / 3_600_000,
							"history interval",
						),
		});
	}
	const hoursCovered = numeric(
		samples.reduce((sum, r) => sum + r.intervalHours, 0),
		"hoursCovered",
	);
	const averageRatePerHour = samples.length
		? numeric(
				samples.reduce((sum, r) => sum + r.ratePerInterval, 0) / hoursCovered,
				"averageRatePerHour",
			)
		: null;
	const hourly = samples.map((r) =>
		numeric(r.ratePerInterval / r.intervalHours, "historical ratePerHour"),
	);
	const annualizedPct =
		averageRatePerHour === null
			? null
			: numeric(
					annualizePeriodicFundingPct(averageRatePerHour, 1),
					"historical annualizedPct",
				);
	return {
		venue,
		market,
		samples,
		sampleCount: samples.length,
		hoursCovered,
		averageRatePerHour,
		annualizedPct,
		minRatePerHour: hourly.length ? Math.min(...hourly) : null,
		maxRatePerHour: hourly.length ? Math.max(...hourly) : null,
		startTime,
		endTime,
		observedAt: timestamp(now(), "history observedAt"),
		source: "direct",
		annualizationMethod: "simple",
	};
}
