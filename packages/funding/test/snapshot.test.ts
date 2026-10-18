import { expect, test } from "bun:test";
import {
	aster,
	binance,
	bingx,
	bitget,
	bybit,
	fetchSnapshot,
	gate,
	grvt,
	hyperliquid,
	lighter,
	lighterMainnet,
	mexc,
	type ObservedFundingRate,
	okx,
	qfex,
	type VenueAdapter,
	variational,
} from "../src/main.ts";
import { changed, expected, fixtureContext, observedAt } from "./fixtures.ts";

const adapters = [
	hyperliquid,
	lighter,
	lighterMainnet,
	aster,
	binance,
	bybit,
	okx,
	mexc,
	bingx,
	bitget,
	gate,
	grvt,
	variational,
	qfex,
];

test("snapshot includes all sources, native listed names, and exact observation metadata", async () => {
	const { ctx } = await fixtureContext();
	const snapshot = await fetchSnapshot(adapters, {
		timeoutMs: 1000,
		fetch: ctx.fetch,
		now: ctx.now,
	});
	expect(snapshot).toEqual({
		observedAt,
		rates: adapters.flatMap(
			(adapter) => expected[adapter.venue as keyof typeof expected],
		),
		listed: [
			...new Set(
				adapters
					.flatMap(
						(adapter) => expected[adapter.venue as keyof typeof expected],
					)
					.map((row) => `${row.venue}:${row.market}`),
			),
		],
		failed: [],
		source: "direct",
		annualizationMethod: "simple",
	});
	expect(snapshot.listed).toContain("hl:kPEPE");
	expect(snapshot.listed).toContain("hl:xyz:NVDA");
	expect(snapshot.listed).toContain("aster:USD1:BTC");
	expect(
		snapshot.rates
			.filter((row) => row.venue === "hl" && row.market === "BTC")
			.map((row) => row.source),
	).toEqual(["direct"]);
	expect(snapshot.listed).toHaveLength(snapshot.rates.length);
});

test("a malformed row removes the whole adapter, leaving other venues intact", async () => {
	const file = "aster/premiumIndex.json";
	const { ctx } = await fixtureContext({
		[file]: await changed(file, [1, "lastFundingRate"], null),
	});
	const snapshot = await fetchSnapshot([aster, binance], {
		timeoutMs: 1000,
		fetch: ctx.fetch,
		now: ctx.now,
	});
	expect(snapshot.rates).toEqual(expected.binance);
	expect(snapshot.failed).toEqual([
		{
			venue: "aster",
			error: "ARGUSUSDT lastFundingRate: expected finite number",
		},
	]);
	expect(snapshot.listed.every((key) => key.startsWith("binance:"))).toBe(true);
});

test("reports a builder failure in failed[] while preserving healthy dex rows", async () => {
	const { ctx } = await fixtureContext({
		"hyperliquid/xyz-caps.json": new Response("unavailable", { status: 503 }),
	});
	const snapshot = await fetchSnapshot([hyperliquid], {
		timeoutMs: 1000,
		fetch: ctx.fetch,
		now: ctx.now,
	});
	expect(snapshot.rates).toEqual(
		expected.hl.filter((row) => !row.market.startsWith("xyz:")),
	);
	expect(snapshot.failed[0]?.venue).toBe("hl");
	expect(snapshot.failed[0]?.error).toContain("dex xyz:");
});

test("a failed direct venue has no rows supplied by Lighter", async () => {
	const { ctx } = await fixtureContext({
		"binance/premiumIndex.json": new Response("blocked", { status: 451 }),
	});
	const snapshot = await fetchSnapshot([binance, lighter], {
		timeoutMs: 1000,
		fetch: ctx.fetch,
		now: ctx.now,
	});
	expect(snapshot.failed[0]?.venue).toBe("binance");
	expect(snapshot.rates).toEqual(expected.lighter);
	expect(snapshot.rates.some((row) => row.venue === "binance")).toBe(false);
});

test("a stalled builder times out independently and keeps core and other builder rows", async () => {
	const { ctx } = await fixtureContext();
	let builderSignal: AbortSignal | null | undefined;
	const snapshot = await fetchSnapshot([hyperliquid], {
		timeoutMs: 100,
		now: ctx.now,
		fetch: (url, init) => {
			if (
				typeof init?.body === "string" &&
				JSON.parse(init.body).dex === "xyz"
			) {
				builderSignal = init.signal;
				return new Promise(() => {});
			}
			return ctx.fetch(url, init);
		},
	});
	expect(builderSignal?.aborted).toBe(true);
	expect(snapshot.rates).toEqual(
		expected.hl.filter((row) => !row.market.startsWith("xyz:")),
	);
	expect(snapshot.failed).toHaveLength(1);
	expect(snapshot.failed[0]?.error).toContain("dex xyz: Timed out");
});

test("timeout aborts pending requests and never waits for an uncooperative adapter", async () => {
	let signal: AbortSignal | undefined;
	const never: VenueAdapter = {
		venue: "stalled",
		tier: "C",
		fetchRates: (ctx) => {
			signal = ctx.signal;
			return new Promise(() => {});
		},
	};
	const { ctx } = await fixtureContext();
	const snapshot = await fetchSnapshot([never, aster], {
		timeoutMs: 20,
		fetch: ctx.fetch,
		now: ctx.now,
	});
	expect(signal?.aborted).toBe(true);
	expect(snapshot.rates).toEqual(expected.aster);
	expect(snapshot.failed).toEqual([
		{ venue: "stalled", error: "Timed out after 20ms" },
	]);
});

test("timeout reaches HTTP fetch and no old snapshot is reused", async () => {
	const { ctx } = await fixtureContext();
	const first = await fetchSnapshot([aster], {
		timeoutMs: 1000,
		fetch: ctx.fetch,
		now: ctx.now,
	});
	expect(first.rates).toHaveLength(4);
	let aborted = 0;
	const second = await fetchSnapshot([aster], {
		timeoutMs: 10,
		now: ctx.now,
		fetch: (_, init) =>
			new Promise((_, reject) => {
				init?.signal?.addEventListener(
					"abort",
					() => {
						aborted++;
						reject(init.signal?.reason);
					},
					{ once: true },
				);
			}),
	});
	expect(aborted).toBe(3);
	expect(second.rates).toEqual([]);
	expect(second.listed).toEqual([]);
	expect(second.failed[0]?.venue).toBe("aster");
});

test("sync throws and non-Error rejections are isolated", async () => {
	const sync: VenueAdapter = {
		venue: "sync",
		tier: "B",
		fetchRates() {
			throw new Error("sync failure");
		},
	};
	const asyncFailure: VenueAdapter = {
		venue: "async",
		tier: "B",
		fetchRates: () => Promise.reject("plain failure"),
	};
	const snapshot = await fetchSnapshot([sync, asyncFailure], {
		timeoutMs: 1000,
	});
	expect(snapshot.rates).toEqual([]);
	expect(snapshot.failed).toEqual([
		{ venue: "sync", error: "sync failure" },
		{ venue: "async", error: "plain failure" },
	]);
});

test("invalid third-party adapter output is isolated at the snapshot boundary", async () => {
	const invalid: VenueAdapter = {
		venue: "bad",
		tier: "B",
		fetchRates: async () => [
			{ ...expected.aster[0], intervalHours: 0 } as ObservedFundingRate,
		],
	};
	expect(
		(await fetchSnapshot([invalid], { timeoutMs: 1000 })).failed[0]?.error,
	).toContain("invalid funding math");
});

test.each([0, -1, 0.1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
	"invalid timeout %s throws before requests",
	async (timeoutMs) => {
		await expect(fetchSnapshot([], { timeoutMs })).rejects.toThrow("timeoutMs");
	},
);

test("empty adapter list returns an empty, fresh snapshot", async () => {
	expect(
		await fetchSnapshot([], { timeoutMs: 1000, now: () => observedAt }),
	).toEqual({
		observedAt,
		rates: [],
		listed: [],
		failed: [],
		source: "direct",
		annualizationMethod: "simple",
	});
});
