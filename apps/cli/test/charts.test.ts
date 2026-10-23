import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	annualizePeriodicFundingPct,
	type ObservedFundingRate,
} from "@mstack/funding";
import candles from "../../../packages/funding/fixtures/candles/manifest.json";
import { lineChart } from "../src/chart.ts";
import { oilView } from "../src/commands/oil.ts";
import { realizedSpreads } from "../src/commands/realized.ts";
import { run } from "../src/run.ts";

const home = await mkdtemp(join(tmpdir(), "mob-charts-test-"));
afterAll(() => rm(home, { recursive: true, force: true }));

const recorded = candles as {
	startTime: number;
	endTime: number;
	requests: { file: string; url: string; method: string; body?: string }[];
};
const candleFetch = async (url: string, init?: RequestInit) => {
	const record = recorded.requests.find(
		(item) =>
			item.url === url &&
			item.method === (init?.method ?? "GET") &&
			item.body === init?.body,
	);
	if (!record) return new Response("not recorded", { status: 404 });
	return Response.json(
		await Bun.file(
			new URL(
				`../../../packages/funding/fixtures/${record.file}`,
				import.meta.url,
			),
		).json(),
	);
};

async function invoke(args: string[]) {
	const out: string[] = [];
	const err: string[] = [];
	const code = await run(args, {
		fetch: candleFetch,
		now: () => recorded.endTime,
		home,
		out: (s) => out.push(s),
		err: (s) => err.push(s),
	});
	return { code, out: out.join("\n"), err: err.join("\n") };
}

test("spread charts the second market over the first from aligned candle closes", async () => {
	// The recorded window is three hours: 0.125 days.
	const result = await invoke([
		"spread",
		"hl:BTC",
		"binance:BTCUSDT",
		"--days",
		"0.125",
		"--json",
	]);
	expect(result.code).toBe(0);
	const body = JSON.parse(result.out);
	expect(body).toMatchObject({
		a: "hl:BTC",
		b: "binance:BTCUSDT",
		interval: "1h",
	});
	expect(body.points.length).toBeGreaterThanOrEqual(2);
	for (const point of body.points)
		expect(point.spreadPct).toBeCloseTo(
			((point.b - point.a) / point.a) * 100,
			10,
		);
	expect(body.stats.last).toBe(body.points[body.points.length - 1].spreadPct);
	expect(body.stats.min).toBeLessThanOrEqual(body.stats.max);
	const human = await invoke([
		"spread",
		"hl:BTC",
		"binance:BTCUSDT",
		"--days",
		"0.125",
	]);
	expect(human.out).toContain(
		"Spread: binance:BTCUSDT over hl:BTC · 1h candles",
	);
	expect(human.out).toMatch(/│.*•/);
	expect(human.out).toContain("now ");
	expect((await invoke(["spread", "hl:BTC"])).err).toContain(
		"Usage: mob spread",
	);
	expect((await invoke(["spread", "hl:BTC", "hl:BTC"])).err).toContain(
		"Choose two different markets",
	);
	expect((await invoke(["spread", "hl:BTC", "kraken:BTC"])).err).toContain(
		"Invalid venues",
	);
	expect(
		(
			await invoke([
				"spread",
				"hl:BTC",
				"binance:BTCUSDT",
				"--interval",
				"15m",
				"--days",
				"30",
			])
		).err,
	).toContain("--days is capped at 7 for 15m candles");
	expect(
		(await invoke(["spread", "hl:BTC", "binance:BTCUSDT", "--interval", "2h"]))
			.err,
	).toContain("--interval must be one of");
});

test("the line chart scales to its range, labels the ends, and draws zero inside the range", () => {
	const lines = lineChart([-1, 0, 1, 2], {
		height: 4,
		width: 10,
		format: (v) => `${v}%`,
	});
	expect(lines).toHaveLength(4);
	// Labels align right against the axis.
	expect(lines[0]).toMatch(/^ 2% │/);
	expect(lines[3]).toMatch(/^-1% │/);
	// Zero falls on a row of its own, drawn with dashes.
	expect(
		lines.some(
			(line) => line.trimStart().startsWith("0%") && line.includes("-"),
		),
	).toBe(true);
	expect(lines.join("\n").split("•").length - 1).toBe(4);
	const flat = lineChart([5, 5, 5], { height: 4, format: String });
	expect(flat.join("\n").split("•").length - 1).toBe(3);
	expect(lineChart([], { format: String })).toEqual([]);
	// Many points fold into the width.
	const wide = lineChart(
		Array.from({ length: 500 }, (_, i) => i),
		{ width: 50, height: 5, format: String },
	);
	expect(
		Math.max(...wide.map((line) => line.split("│")[1].length)),
	).toBeLessThanOrEqual(50);
});

function rate(
	venue: string,
	market: string,
	markPrice: number,
	ratePerInterval: number,
	volume24hUsd = 5_000_000,
): ObservedFundingRate {
	return {
		venue,
		market,
		ratePerInterval,
		intervalHours: 1,
		annualizedPct: annualizePeriodicFundingPct(ratePerInterval, 1) as number,
		observedAt: 1,
		source: "direct",
		annualizationMethod: "simple",
		markPrice,
		volume24hUsd,
	};
}

test("oil pairs each venue's WTI and Brent, folding venue spellings, and finds the best carry", () => {
	const view = oilView([
		rate("hl", "xyz:CL", 100, -0.0001),
		rate("hl", "xyz:BRENTOIL", 109, 0.0002),
		rate("binance", "CLUSDT", 100.2, 0.0001),
		rate("binance", "BZUSDT", 109.3, -0.0003),
		rate("mexc", "USOIL_USDT", 100.1, 0),
		rate("lighter-mainnet", "WTI", 100, 0, 500_000),
	]);
	const hl = view.view.find((row) => row.venue === "hl");
	expect(hl?.wti?.market).toBe("xyz:CL");
	expect(hl?.brent?.market).toBe("xyz:BRENTOIL");
	expect(hl?.brentPremiumPct).toBeCloseTo(9, 10);
	// Long WTI, short Brent earns Brent's funding and pays WTI's.
	expect(hl?.carryLongWtiPct).toBeCloseTo((0.0002 + 0.0001) * 8760 * 100, 8);
	expect(view.view.find((row) => row.venue === "mexc")?.wti?.market).toBe(
		"USOIL_USDT",
	);
	expect(view.view.find((row) => row.venue === "mexc")?.brent).toBeUndefined();
	expect(view.premium?.min).toBeCloseTo(9, 10);
	expect(view.premium?.max).toBeCloseTo(((109.3 - 100.2) / 100.2) * 100, 10);
	// The best carry: long the Brent paying -0.0003 on Binance, short WTI earning +0.0001 there.
	expect(view.best).toMatchObject({
		direction: "long Brent, short WTI",
		long: "binance:BZUSDT",
		mob: false,
	});
	// A thin listing never makes the best pair.
	expect(view.best?.long).not.toContain("lighter-mainnet");
	expect(oilView([]).best).toBeNull();
});

test("realized spreads average each leg's settlements per window and name legs without history", async () => {
	const HOUR = 3_600_000;
	const now = 1_791_635_200_000;
	// hl pays 0.0001 an hour for 30 days; Lighter pays 0.0003 in the last day only.
	const fetch = async (url: string, init?: RequestInit) => {
		if (url === "https://api.hyperliquid.xyz/info") {
			const body = JSON.parse(String(init?.body));
			if (body.startTime > now) return Response.json([]);
			return Response.json(
				Array.from({ length: 720 }, (_, i) => ({
					coin: "BTC",
					time: now - (719 - i) * HOUR,
					fundingRate: "0.0001",
					premium: "0",
				})).filter((row) => row.time >= body.startTime),
			);
		}
		if (url.endsWith("/orderBookDetails"))
			return Response.json({
				code: 200,
				order_book_details: [{ symbol: "BTC", market_id: 1 }],
			});
		if (url.includes("/fundings?")) {
			const params = new URL(url).searchParams;
			const from = Number(params.get("start_timestamp")) * 1000;
			const to = Number(params.get("end_timestamp")) * 1000;
			const rows = Array.from({ length: 720 }, (_, i) => now - (719 - i) * HOUR)
				.filter((time) => time >= from && time <= to)
				.map((time) => ({
					timestamp: time / 1000,
					value: "0",
					rate: time > now - 24 * HOUR ? "0.03" : "0.01",
					direction: "long",
				}));
			return Response.json({ code: 200, resolution: "1h", fundings: rows });
		}
		return new Response("not recorded", { status: 404 });
	};
	const pairs = [
		{
			long: { venue: "hl", market: "BTC" },
			short: { venue: "lighter-mainnet", market: "BTC" },
		},
		{
			long: { venue: "hl", market: "BTC" },
			short: { venue: "gate", market: "BTC_USDT" },
		},
	];
	const result = await realizedSpreads(pairs, { fetch, now: () => now, home });
	const lighter = result.get("hl:BTC>lighter-mainnet:BTC");
	// Last day: 0.0003 − 0.0001 an hour. 30 days: (24 × 0.0003 + 696 × 0.0001) / 720 − 0.0001.
	expect(lighter?.d1).toBeCloseTo(0.0002 * 8760 * 100, 6);
	expect(lighter?.d30).toBeCloseTo(
		((24 * 0.0003 + 696 * 0.0001) / 720 - 0.0001) * 8760 * 100,
		6,
	);
	expect(result.get("hl:BTC>gate:BTC_USDT")).toEqual({
		d1: null,
		d7: null,
		d30: null,
		reason: "gate has no keyless history",
	});
});
