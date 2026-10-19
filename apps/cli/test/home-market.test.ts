import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ObservedFundingRate, Snapshot } from "@mstack/funding";
import { selectedVenues } from "../src/commands/runtime.ts";
import {
	collectHomeMarket,
	HOME_MARKET_BUDGET_MS,
} from "../src/home-market.ts";
import type { Runtime } from "../src/run.ts";

const homes: string[] = [];
afterEach(async () => {
	await Promise.all(
		homes.splice(0).map((home) => rm(home, { recursive: true })),
	);
});

function rate(
	venue: string,
	market: string,
	annualizedPct: number,
	volume24hUsd: number,
): ObservedFundingRate {
	return {
		venue,
		market,
		ratePerInterval: annualizedPct / 100 / 8760,
		intervalHours: 1,
		annualizedPct,
		observedAt: 1_800_000_000_000,
		markPrice: 100,
		volume24hUsd,
		openInterestUsd: volume24hUsd / 2,
		priceChange24hPct: 2,
		source: "direct",
		annualizationMethod: "simple",
	};
}

function snapshot(
	rates: ObservedFundingRate[],
	failed: Snapshot["failed"] = [],
): Snapshot {
	return {
		observedAt: 1_800_000_000_000,
		rates,
		listed: rates.map((row) => `${row.venue}:${row.market}`),
		failed,
		source: "direct",
		annualizationMethod: "simple",
	};
}

async function runtime(marketSnapshot: (budget: number) => Promise<Snapshot>) {
	const home = await mkdtemp(join(tmpdir(), "mstack-home-market-"));
	homes.push(home);
	return {
		home,
		now: () => 1_800_000_000_000,
		fetch: globalThis.fetch,
		homeServices: { marketSnapshot },
		out: () => {},
		err: () => {},
	} satisfies Runtime;
}

test("live greeting uses the five-second budget and excludes a stalled venue", async () => {
	let budget = 0;
	const rt = await runtime(async (value) => {
		budget = value;
		return snapshot(
			[
				rate("hl", "BTC", -20, 20_000_000),
				rate("lighter", "BTC", 80, 10_000_000),
			],
			[{ venue: "okx", error: "Timed out after 5000ms" }],
		);
	});
	const market = await collectHomeMarket(rt);
	expect(budget).toBe(HOME_MARKET_BUDGET_MS);
	expect(market.topPairs[0]).toMatchObject({
		base: "BTC",
		longVenue: "hl",
		shortVenue: "lighter",
	});
	expect(market.trending[0]).toMatchObject({
		base: "BTC",
		volume24hUsd: 30_000_000,
	});
	expect(market.freshness).toMatchObject({
		state: "live",
		succeeded: 2,
		total: selectedVenues().length,
		failed: ["okx"],
	});
});

test("unreachable venues fall back to the cache with its age", async () => {
	const live = snapshot([
		rate("hl", "SOL", -10, 4_000_000),
		rate("lighter", "SOL", 50, 3_000_000),
	]);
	const rt = await runtime(async () => live);
	await collectHomeMarket(rt);
	rt.now = () => live.observedAt + 4 * 60_000;
	rt.homeServices = { marketSnapshot: async () => snapshot([]) };
	const cached = await collectHomeMarket(rt);
	expect(cached.topPairs[0]?.base).toBe("SOL");
	expect(cached.freshness).toMatchObject({ state: "cached", ageMs: 240_000 });
});

test("offline uses only the cache and reports empty offline state without one", async () => {
	let called = false;
	const rt = await runtime(async () => {
		called = true;
		return snapshot([]);
	});
	const market = await collectHomeMarket(rt, { offline: true });
	expect(called).toBe(false);
	expect(market).toMatchObject({
		topPairs: [],
		trending: [],
		freshness: {
			state: "offline",
			succeeded: 0,
			total: selectedVenues().length,
		},
	});
});
