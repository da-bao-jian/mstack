import { expect, test } from "bun:test";
import { type Fetch, fetchFundingHistory } from "../src/main.ts";

async function recorded(venue: string) {
	return Bun.file(
		new URL(
			`../fixtures/${venue === "hl" ? "hyperliquid" : venue}/history.json`,
			import.meta.url,
		),
	).json();
}

function records(venue: string, body: unknown): Record<string, unknown>[] {
	return (
		venue === "okx"
			? (body as { data: unknown }).data
			: venue === "bybit"
				? (body as { result: { list: unknown } }).result.list
				: body
	) as Record<string, unknown>[];
}

function time(venue: string, row: Record<string, unknown>): number {
	return Number(
		row[
			venue === "hl"
				? "time"
				: venue === "bybit"
					? "fundingRateTimestamp"
					: "fundingTime"
		],
	);
}

function envelope(venue: string, rows: unknown[]) {
	return venue === "okx"
		? { code: "0", data: rows }
		: venue === "bybit"
			? { retCode: 0, result: { list: rows } }
			: rows;
}

for (const venue of ["hl", "binance", "aster", "bybit", "okx"]) {
	test(`${venue} recorded history uses measured intervals and simple averages`, async () => {
		const raw = await recorded(venue);
		const rows = records(venue, raw).sort(
			(a, b) => time(venue, a) - time(venue, b),
		);
		const startTime = time(venue, rows[1]);
		const endTime = time(venue, rows.at(-1) as Record<string, unknown>);
		const calls: string[] = [];
		const fetch: Fetch = async (url, init) => {
			calls.push(url);
			expect(init?.redirect).toBe("error");
			const query = new URL(url).searchParams;
			const start =
				venue === "hl"
					? JSON.parse(String(init?.body)).startTime
					: Number(query.get("startTime") ?? 0);
			const end =
				venue === "hl" ? endTime : Number(query.get("endTime") ?? endTime);
			return Response.json(
				envelope(
					venue,
					rows.filter((r) => time(venue, r) >= start && time(venue, r) <= end),
				),
			);
		};
		const result = await fetchFundingHistory(
			venue,
			venue === "hl" || venue === "aster"
				? "BTC"
				: venue === "okx"
					? "BTC-USDT-SWAP"
					: "BTCUSDT",
			{ startTime, endTime, fetch, now: () => endTime },
		);
		expect(result.sampleCount).toBe(4);
		expect(result.hoursCovered).toBeCloseTo(venue === "hl" ? 4 : 32, 5);
		const sum = rows
			.slice(1)
			.reduce(
				(sum, r) =>
					sum + Number(r[venue === "okx" ? "realizedRate" : "fundingRate"]),
				0,
			);
		expect(result.averageRatePerHour).toBe(sum / result.hoursCovered);
		expect(result.annualizedPct).toBe(
			(sum / result.hoursCovered) * 24 * 365 * 100,
		);
		expect(result.annualizationMethod).toBe("simple");
		expect(calls.length).toBeGreaterThan(0);
		if (venue === "aster")
			expect(
				calls.every((url) => new URL(url).searchParams.has("startTime")),
			).toBe(true);
	});

	test(`${venue} malformed history fails without a fallback`, async () => {
		const body = await recorded(venue);
		records(venue, body)[0][venue === "okx" ? "realizedRate" : "fundingRate"] =
			"not-a-number";
		await expect(
			fetchFundingHistory(venue, "BTC", {
				startTime: 1,
				endTime: 2,
				fetch: async () => Response.json(body),
			}),
		).rejects.toThrow();
	});
}

test("changing historical intervals uses total funding divided by total hours", async () => {
	const original = (await recorded("binance"))[0];
	// Mutate recorded settlements into a 4h then 8h interval transition.
	const rows = [0, 4, 12].map((hours, i) => ({
		...original,
		fundingTime: 1_000_000 + hours * 3_600_000,
		fundingRate: ["0", "0.004", "0.016"][i],
	}));
	const result = await fetchFundingHistory("binance", "BTCUSDT", {
		startTime: 2_000_000,
		endTime: 50_000_000,
		fetch: async (url) => {
			expect(new URL(url).searchParams.has("startTime")).toBe(true);
			return Response.json(rows);
		},
	});
	expect(result.hoursCovered).toBe(12);
	expect(result.averageRatePerHour).toBe(0.02 / 12);
	expect(result.minRatePerHour).toBe(0.001);
	expect(result.maxRatePerHour).toBe(0.002);
});

test("OKX paginates with after and consumes the older boundary", async () => {
	const original = records("okx", await recorded("okx"))[0];
	const rows = Array.from({ length: 103 }, (_, i) => ({
		...original,
		fundingTime: String(10_000_000 + i * 3_600_000),
	})).reverse();
	const cursors: (string | null)[] = [];
	const result = await fetchFundingHistory("okx", "BTC-USDT-SWAP", {
		startTime: 10_000_001,
		endTime: 400_000_000,
		fetch: async (url) => {
			const after = new URL(url).searchParams.get("after");
			cursors.push(after);
			return Response.json(
				envelope(
					"okx",
					rows
						.filter(
							(r) => after === null || Number(r.fundingTime) < Number(after),
						)
						.slice(0, 100),
				),
			);
		},
	});
	expect(cursors).toEqual([null, rows[99].fundingTime]);
	expect(result.sampleCount).toBe(102);
	expect(result.hoursCovered).toBe(102);
});

test.each(["binance", "bybit"])(
	"%s paginates without counting a boundary twice",
	async (venue) => {
		const original = records(venue, await recorded(venue))[0];
		const key = venue === "bybit" ? "fundingRateTimestamp" : "fundingTime";
		const limit = venue === "bybit" ? 200 : 1000;
		const rows = Array.from({ length: limit + 3 }, (_, i) => ({
			...original,
			[key]: 1_000_000 + i * 3_600_000,
		}));
		let calls = 0;
		const result = await fetchFundingHistory(venue, "BTCUSDT", {
			startTime: 1_000_001,
			endTime: 10_000_000_000,
			fetch: async (url) => {
				calls++;
				const q = new URL(url).searchParams;
				const start = Number(q.get("startTime") ?? 0),
					end = Number(q.get("endTime"));
				const eligible = rows.filter(
					(r) => Number(r[key]) >= start && Number(r[key]) <= end,
				);
				return Response.json(
					envelope(
						venue,
						(venue === "bybit" ? eligible.reverse() : eligible).slice(
							0,
							Number(q.get("limit")),
						),
					),
				);
			},
		});
		expect(result.sampleCount).toBe(limit + 2);
		expect(calls).toBe(venue === "bybit" ? 3 : 2);
	},
);

test("missing predecessor fails instead of assuming today's interval", async () => {
	const rows = await recorded("binance");
	await expect(
		fetchFundingHistory("binance", "BTCUSDT", {
			startTime: rows[0].fundingTime,
			endTime: rows.at(-1).fundingTime,
			fetch: async (url) =>
				Response.json(new URL(url).searchParams.has("startTime") ? rows : []),
		}),
	).rejects.toThrow("no preceding settlement");
});

test("HTTP failure and unsupported venues are explicit", async () => {
	await expect(
		fetchFundingHistory("hl", "BTC", {
			startTime: 1,
			endTime: 2,
			fetch: async () => new Response("unavailable", { status: 503 }),
		}),
	).rejects.toThrow("HTTP 503");
	await expect(
		fetchFundingHistory("lighter", "BTC", { startTime: 1, endTime: 2 }),
	).rejects.toThrow("no keyless history");
});

test.each([
	{ venue: "hl", market: "xyz:NVDA", symbol: "xyz:NVDA" },
	{ venue: "aster", market: "USD1:BTC", symbol: "BTCUSD1" },
])(
	"history requests preserve $market in the venue namespace",
	async ({ venue, market, symbol }) => {
		const original = records(venue, await recorded(venue));
		const rows = original
			.map((row) => ({ ...row, [venue === "hl" ? "coin" : "symbol"]: symbol }))
			.sort((a, b) => time(venue, a) - time(venue, b));
		const startTime = time(venue, rows[1]);
		const endTime = time(venue, rows.at(-1) as Record<string, unknown>);
		const result = await fetchFundingHistory(venue, market, {
			startTime,
			endTime,
			fetch: async (url, init) => {
				if (venue === "hl") {
					const body = JSON.parse(String(init?.body));
					expect(body.coin).toBe(symbol);
					return Response.json(
						rows.filter((r) => time(venue, r) >= body.startTime),
					);
				}
				expect(new URL(url).searchParams.get("symbol")).toBe(symbol);
				return Response.json(rows);
			},
		});
		expect(result.market).toBe(market);
		expect(result.sampleCount).toBe(4);
	},
);

test("OKX repeated pagination fails instead of looping or duplicating history", async () => {
	const original = records("okx", await recorded("okx"))[0];
	const rows = Array.from({ length: 100 }, (_, i) => ({
		...original,
		fundingTime: String(10_000_000 + i * 3_600_000),
	}));
	await expect(
		fetchFundingHistory("okx", "BTC-USDT-SWAP", {
			startTime: 1,
			endTime: 400_000_000,
			fetch: async () => Response.json(envelope("okx", rows)),
		}),
	).rejects.toThrow("cursor did not advance");
});

test("historical annualization overflow fails instead of serializing Infinity as null", async () => {
	const original = records("hl", await recorded("hl"))[0];
	await expect(
		fetchFundingHistory("hl", "BTC", {
			startTime: 1,
			endTime: 2,
			fetch: async (_url, init) =>
				Response.json(
					JSON.parse(String(init?.body)).startTime === 1
						? [{ ...original, time: 1, fundingRate: "1e308" }]
						: [],
				),
		}),
	).rejects.toThrow("historical annualizedPct");
});
