import { expect, test } from "bun:test";
import type { Fetch } from "../../../packages/funding/src/main.ts";
import expected from "../../../packages/funding/test/expected.json";
import { fixtureContext } from "../../../packages/funding/test/fixtures.ts";
import { rankOpportunities } from "../../../packages/opportunities/src/index.ts";
import { scanView } from "../src/render.ts";
import { run } from "../src/run.ts";

test("view priority precedes per-base selection and all-pairs retains alternatives", () => {
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
	const sample = result.opportunities[0];
	result.opportunities = [
		{
			...sample,
			base: "BTC",
			qualifies: false,
			executable: true,
			spreadAnnualizedPct: 1000,
		},
		{
			...sample,
			base: "BTC",
			qualifies: true,
			executable: false,
			spreadAnnualizedPct: 100,
		},
		{
			...sample,
			base: "BTC",
			qualifies: true,
			executable: true,
			spreadAnnualizedPct: 1,
		},
		{
			...sample,
			base: "ETH",
			qualifies: true,
			executable: false,
			spreadAnnualizedPct: 200,
		},
	];
	const options = { top: 15, allPairs: false, executable: false };
	expect(
		scanView(result, options).view.map((r) => [r.base, r.spreadAnnualizedPct]),
	).toEqual([
		["BTC", 1],
		["ETH", 200],
	]);
	expect(
		scanView(result, { ...options, allPairs: true }).view.map(
			(r) => r.spreadAnnualizedPct,
		),
	).toEqual([1, 200, 100, 1000]);
});

test("history resolves a normalized base to native market and reports Lighter explicitly", async () => {
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
		[
			"history",
			"PEPE",
			"--venues",
			"hl,lighter,lighter-mainnet",
			"--days",
			"3",
			"--json",
		],
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
		{ venue: "lighter", reason: "no keyless history" },
		{ venue: "lighter-mainnet", reason: "no keyless history" },
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
