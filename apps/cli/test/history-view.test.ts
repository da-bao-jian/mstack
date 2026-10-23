import { expect, test } from "bun:test";
import type { Fetch } from "../../../packages/funding/src/main.ts";
import expected from "../../../packages/funding/test/expected.json";
import { fixtureContext } from "../../../packages/funding/test/fixtures.ts";
import { rankOpportunities } from "../../../packages/opportunities/src/index.ts";
import { scanView } from "../src/render.ts";
import { run } from "../src/run.ts";

test("net APY sorts both sections independently, selects per base, and puts null last", () => {
	const result = rankOpportunities(
		{
			observedAt: 1,
			source: "direct",
			annualizationMethod: "simple",
			failed: [],
			listed: [],
			rates: Object.values(expected).flat() as Parameters<
				typeof rankOpportunities
			>[0]["rates"],
		},
		{ sizeUsd: 1000 },
	);
	// The ranked top pair may carry a thin or cross-deployment flag, which the
	// view would hide; the sorting test needs an unflagged template row.
	const sample = result.opportunities.find((r) => r.flags.length === 0);
	if (!sample) throw new Error("fixture snapshot has no unflagged pair");
	result.opportunities = [
		{
			...sample,
			base: "BTC",
			qualifies: false,
			executable: true,
			spreadAnnualizedPct: 1000,
			netApyPct: null,
		},
		{
			...sample,
			base: "BTC",
			qualifies: true,
			executable: false,
			spreadAnnualizedPct: 100,
			netApyPct: 90,
		},
		{
			...sample,
			base: "BTC",
			qualifies: true,
			executable: true,
			spreadAnnualizedPct: 1,
			netApyPct: -1,
		},
		{
			...sample,
			base: "ETH",
			qualifies: true,
			executable: false,
			spreadAnnualizedPct: 200,
			netApyPct: 190,
		},
	];
	const options = { top: 15, allPairs: false, executable: false };
	expect(
		scanView(result, options).view.anywhere.map((r) => [r.base, r.netApyPct]),
	).toEqual([
		["ETH", 190],
		["BTC", 90],
	]);
	expect(
		scanView(result, options).view.executable.map((r) => r.netApyPct),
	).toEqual([-1]);
	expect(
		scanView(result, { ...options, allPairs: true }).view.anywhere.map(
			(r) => r.netApyPct,
		),
	).toEqual([190, 90, -1, null]);
	expect(
		scanView(result, { ...options, allPairs: true, topExec: 1 }).view
			.executable,
	).toHaveLength(1);
	expect(
		scanView(result, { ...options, market: "ETH" }).view.executable,
	).toEqual([]);
});

test("history resolves a normalized base to native market and names venues without history", async () => {
	const { ctx } = await fixtureContext();
	const raw = await Bun.file(
		new URL(
			"../../../packages/funding/fixtures/hyperliquid/history.json",
			import.meta.url,
		),
	).json();
	// Recorded BTC history relabeled to the snapshot's real kPEPE market.
	const history = raw.map((r: Record<string, unknown>) => ({
		...r,
		coin: "kPEPE",
	}));
	const queries: Record<string, unknown>[] = [];
	const fetch: Fetch = async (url, init) => {
		if (url.includes("hyperliquid") && init?.body) {
			const body = JSON.parse(String(init.body));
			if (body.type === "fundingHistory") {
				queries.push(body);
				expect(body.coin).toBe("kPEPE");
				return Response.json(
					history.filter(
						(r: { time: number }) =>
							r.time >= body.startTime && r.time <= body.endTime,
					),
				);
			}
		}
		return ctx.fetch(url, init);
	};
	const out: string[] = [],
		err: string[] = [];
	const code = await run(
		["history", "PEPE", "--venues", "hl,gate,mexc", "--days", "3", "--json"],
		{
			fetch,
			now: () => 1791637459597,
			home: "/tmp/mob-no-such-config-for-history-tests",
			out: (s) => out.push(s),
			err: (s) => err.push(s),
		},
	);
	expect(code).toBe(0);
	const body = JSON.parse(out[0]);
	expect(body.history[0].market).toBe("kPEPE");
	expect(body.history[0].sampleCount).toBe(5);
	expect(body.unsupported).toEqual([
		{ venue: "gate", reason: "no keyless history" },
		{ venue: "mexc", reason: "no keyless history" },
	]);
	expect(queries).toHaveLength(2);
	expect(err[0]).toContain("annualized = simple");
});

test("history failures stay visible and strict exits 3", async () => {
	const { ctx } = await fixtureContext();
	const out: string[] = [];
	const code = await run(
		["history", "BTC", "--venues", "hl", "--strict", "--json"],
		{
			fetch: async (url, init) => {
				if (
					init?.body &&
					JSON.parse(String(init.body)).type === "fundingHistory"
				)
					return new Response("unavailable", { status: 503 });
				return ctx.fetch(url, init);
			},
			home: "/tmp/mob-no-such-config-for-history-tests",
			out: (s) => out.push(s),
			err: () => {},
		},
	);
	expect(code).toBe(3);
	const body = JSON.parse(out[0]);
	expect(body.failed[0]).toMatchObject({ venue: "hl", market: "BTC" });
	expect(body.history).toEqual([]);
	expect(body.bestPair).toBeNull();
});
