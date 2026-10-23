import { expect, test } from "bun:test";
import recorded from "../fixtures/candles/manifest.json";
import { fetchCandles, fetchFundingHistory } from "../src/main.ts";

const { startTime, endTime, historyStart, requests } = recorded as {
	startTime: number;
	endTime: number;
	historyStart: number;
	requests: { file: string; url: string; method: string; body?: string }[];
};

function fakeFetch(overrides: { [file: string]: unknown } = {}) {
	return async (url: string, init?: RequestInit) => {
		const record = requests.find(
			(item) =>
				item.url === url &&
				item.method === (init?.method ?? "GET") &&
				item.body === init?.body,
		);
		if (!record) return new Response("not recorded", { status: 404 });
		return Response.json(
			Object.hasOwn(overrides, record.file)
				? overrides[record.file]
				: await Bun.file(
						new URL(`../fixtures/${record.file}`, import.meta.url),
					).json(),
		);
	};
}

const now = () => endTime;

test.each([
	["hl", "BTC"],
	["lighter-mainnet", "BTC"],
	["aster", "BTC"],
	["binance", "BTCUSDT"],
	["bybit", "BTCUSDT"],
	["okx", "BTC-USDT-SWAP"],
	["bitget", "BTCUSDT"],
	["bingx", "BTC-USDT"],
	["gate", "BTC_USDT"],
	["mexc", "BTC_USDT"],
	["grvt", "BTC_USDT_Perp"],
	["pacifica", "BTC"],
	["extended", "BTC-USD"],
	["paradex", "BTC-USD-PERP"],
	["dydx", "BTC-USD"],
	["backpack", "BTC_USDC_PERP"],
	["kucoin", "XBTUSDTM"],
])(
	"%s candles come back oldest first, hourly, inside the window",
	async (venue, market) => {
		const series = await fetchCandles(venue, market, {
			interval: "1h",
			startTime,
			endTime,
			fetch: fakeFetch(),
			now,
		});
		expect(series).toMatchObject({
			venue,
			market,
			interval: "1h",
			observedAt: endTime,
		});
		expect(series.candles.length).toBeGreaterThanOrEqual(2);
		for (const [index, candle] of series.candles.entries()) {
			// Open times sit on the hour; seconds and nanoseconds normalize to ms.
			expect(candle.time % 3_600_000).toBe(0);
			expect(candle.time).toBeGreaterThanOrEqual(startTime - 3_600_000);
			expect(candle.time).toBeLessThanOrEqual(endTime);
			expect(candle.close).toBeGreaterThan(10_000);
			if (index)
				expect(candle.time).toBeGreaterThan(series.candles[index - 1].time);
		}
	},
);

test("candle reads refuse bad windows, venues without candles, and malformed closes", async () => {
	const options = {
		interval: "1h" as const,
		startTime,
		endTime,
		fetch: fakeFetch(),
		now,
	};
	await expect(
		fetchCandles("hl", "BTC", { ...options, startTime: endTime }),
	).rejects.toThrow("startTime must be before endTime");
	await expect(
		fetchCandles("hl", "BTC", { ...options, interval: "2h" as "1h" }),
	).rejects.toThrow("interval must be one of");
	await expect(
		fetchCandles("variational", "BTC-PERP", options),
	).rejects.toThrow("variational publishes no public candles");
	const hl = requests.find((item) => item.body?.includes("candleSnapshot"));
	if (!hl) throw new Error("hl candles not recorded");
	await expect(
		fetchCandles("hl", "BTC", {
			...options,
			fetch: fakeFetch({ [hl.file]: [{ t: startTime, c: "oops" }] }),
		}),
	).rejects.toThrow("hl:BTC: candles[0] close: expected finite number");
});

test("Lighter funding history reads hourly settlements with the paying side as the sign", async () => {
	const history = await fetchFundingHistory("lighter-mainnet", "BTC", {
		startTime: historyStart,
		endTime,
		fetch: fakeFetch(),
		now,
	});
	expect(history.sampleCount).toBeGreaterThan(0);
	for (const sample of history.samples) {
		expect(sample.intervalHours).toBe(1);
		expect(Math.abs(sample.ratePerInterval)).toBeLessThan(0.01);
	}
	const page = requests.find((item) => item.url.includes("/fundings?"));
	if (!page) throw new Error("Lighter fundings not recorded");
	const body = (await Bun.file(
		new URL(`../fixtures/${page.file}`, import.meta.url),
	).json()) as {
		fundings: { rate: string; direction: string }[];
	};
	// "short" means shorts pay longs: the same rate with the opposite sign.
	const flipped = {
		...body,
		fundings: body.fundings.map((row) => ({
			...row,
			direction: row.direction === "long" ? "short" : "long",
		})),
	};
	const opposite = await fetchFundingHistory("lighter-mainnet", "BTC", {
		startTime: historyStart,
		endTime,
		fetch: fakeFetch({ [page.file]: flipped }),
		now,
	});
	expect(opposite.samples.map((sample) => sample.ratePerInterval)).toEqual(
		history.samples.map((sample) => -sample.ratePerInterval),
	);
	await expect(
		fetchFundingHistory("lighter-mainnet", "BTC", {
			startTime: historyStart,
			endTime,
			fetch: fakeFetch({
				[page.file]: {
					...body,
					fundings: [{ ...body.fundings[0], direction: "up" }],
				},
			}),
			now,
		}),
	).rejects.toThrow("expected long or short");
});

test.each([
	["pacifica", "BTC"],
	["extended", "BTC-USD"],
	["dydx", "BTC-USD"],
	["backpack", "BTC_USDC_PERP"],
])(
	"%s funding history is hourly settlements inside the window",
	async (venue, market) => {
		const history = await fetchFundingHistory(venue, market, {
			startTime: historyStart,
			endTime,
			fetch: fakeFetch(),
			now,
		});
		expect(history.sampleCount).toBeGreaterThanOrEqual(5);
		for (const sample of history.samples) {
			expect(sample.intervalHours).toBe(1);
			expect(sample.time).toBeGreaterThanOrEqual(historyStart);
			expect(sample.time).toBeLessThanOrEqual(endTime);
			expect(Math.abs(sample.ratePerInterval)).toBeLessThan(0.01);
		}
	},
);

test("KuCoin history measures each 8-hour interval from the settlement before it", async () => {
	const history = await fetchFundingHistory("kucoin", "XBTUSDTM", {
		startTime: historyStart,
		endTime,
		fetch: fakeFetch(),
		now,
	});
	for (const sample of history.samples)
		expect(sample.intervalHours).toBeGreaterThan(1);
});
