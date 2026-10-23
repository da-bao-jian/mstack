import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import books from "../../../packages/funding/fixtures/books/manifest.json";
import snapshots from "../../../packages/funding/fixtures/manifest.json";
import { fixtureContext } from "../../../packages/funding/test/fixtures.ts";
import { type Runtime, run } from "../src/run.ts";

const home = await mkdtemp(join(tmpdir(), "mob-markets-test-"));
afterAll(() => rm(home, { recursive: true, force: true }));

async function invoke(args: string[], overrides: Partial<Runtime> = {}) {
	const { ctx, calls } = await fixtureContext();
	const out: string[] = [],
		err: string[] = [];
	const code = await run(args, {
		fetch: ctx.fetch,
		now: ctx.now,
		home,
		out: (s) => out.push(s),
		err: (s) => err.push(s),
		...overrides,
	});
	return { code, out: out.join("\n"), err: err.join("\n"), calls };
}

test("venues lists every venue and builder deployment by volume, with lower-bound sums marked", async () => {
	const result = await invoke(["venues", "--json"]);
	expect(result.code).toBe(0);
	const body = JSON.parse(result.out);
	const keys = body.view.map((row: { venue: string }) => row.venue);
	expect(keys).toContain("hl");
	expect(keys).toContain("hl:xyz");
	expect(keys).toContain("hl:io");
	expect(keys).toHaveLength(22);
	expect(new Set(keys).size).toBe(keys.length);
	const volumes = body.view.map(
		(row: { volume24hUsd?: number }) => row.volume24hUsd ?? 0,
	);
	expect(volumes).toEqual([...volumes].sort((a: number, b: number) => b - a));
	const hl = body.view.find((row: { venue: string }) => row.venue === "hl");
	expect(hl).toMatchObject({ kind: "dex", mob: true, takerFeeBps: 4.5 });
	const binance = body.view.find(
		(row: { venue: string }) => row.venue === "binance",
	);
	// Binance publishes no bulk open interest: a dash, never zero.
	expect(binance.openInterestUsd).toBeUndefined();
	expect(binance.missingOpenInterest).toBe(binance.markets);
	const cex = JSON.parse(
		(await invoke(["venues", "--kind", "cex", "--json"])).out,
	);
	expect(cex.view.every((row: { kind: string }) => row.kind === "cex")).toBe(
		true,
	);
	const human = await invoke(["venues"]);
	expect(human.out).toContain("trade.xyz on Hyperliquid");
	expect(human.out).toMatch(/binance\s+Binance\s+CEX\s+—\s+\d+\s+≥\$/);
	expect((await invoke(["venues", "--kind", "spot"])).err).toContain(
		"--kind must be dex or cex",
	);
});

test("markets sums each asset across venues and splits crypto from real-world assets", async () => {
	const body = JSON.parse((await invoke(["markets", "--json"])).out);
	expect(body.scope).toBe("all");
	expect(body.counts.assets).toBe(body.counts.crypto + body.counts.rwa);
	const btc = body.view.find(
		(asset: { ticker: string }) => asset.ticker === "BTC",
	);
	expect(btc).toMatchObject({ class: "crypto", variant: 1 });
	expect(btc.venues).toBeGreaterThan(5);
	// XYZ100 on trade.xyz is the Nasdaq-100: one canonical ticker.
	const us100 = body.view.find(
		(asset: { ticker: string }) => asset.ticker === "US100",
	);
	expect(us100).toMatchObject({ class: "rwa", category: "index" });
	const rwa = JSON.parse((await invoke(["markets", "--rwa", "--json"])).out);
	expect(rwa.scope).toBe("rwa");
	expect(
		rwa.view.every((asset: { class: string }) => asset.class === "rwa"),
	).toBe(true);
	expect(
		rwa.categories.map((row: { category: string }) => row.category),
	).toContain("pre-ipo");
	const preIpo = JSON.parse(
		(await invoke(["markets", "--category", "preipo", "--json"])).out,
	);
	expect(
		preIpo.view.map((asset: { ticker: string }) => asset.ticker).sort(),
	).toEqual(["ANTHROPIC", "OPENAI"]);
	const search = JSON.parse(
		(await invoke(["markets", "--search", "nvid", "--json"])).out,
	);
	expect(search.view.map((asset: { ticker: string }) => asset.ticker)).toEqual([
		"NVDA",
	]);
	expect(
		JSON.parse((await invoke(["markets", "--top", "2", "--json"])).out).view,
	).toHaveLength(2);
	const human = (await invoke(["markets", "--rwa"])).out;
	expect(human).toContain("RWA assets");
	expect(human).toContain("By category");
	expect((await invoke(["markets", "--rwa", "--crypto"])).err).toContain(
		"Choose --rwa or --crypto",
	);
	expect((await invoke(["markets", "--sort", "price"])).err).toContain(
		"--sort must be",
	);
	expect((await invoke(["markets", "--category", "bonds"])).err).toContain(
		"--category must be one of",
	);
});

test("market shows one asset on every venue with shares, funding and the widest spread", async () => {
	const body = JSON.parse((await invoke(["market", "btc", "--json"])).out);
	expect(body.ticker).toBe("BTC");
	expect(body.assets).toHaveLength(1);
	const [btc] = body.assets;
	const shares = btc.rows.reduce(
		(sum: number, row: { volumeSharePct?: number }) =>
			sum + (row.volumeSharePct ?? 0),
		0,
	);
	expect(shares).toBeCloseTo(100, 6);
	const hl = btc.rows.find((row: { venue: string }) => row.venue === "hl");
	// Hyperliquid settles on the hour; its feed omits the time.
	expect(hl.nextFundingSource).toBe("hourly schedule");
	expect(hl.nextFundingAt % 3_600_000).toBe(0);
	expect(hl.mob).toBe(true);
	expect(btc.widest.spreadAnnualizedPct).toBeGreaterThan(0);
	const human = (await invoke(["market", "BTC"])).out;
	expect(human).toContain("Widest funding spread");
	expect(human).toContain("hl:BTC");
	const none = await invoke(["market", "NOPE"]);
	expect(none.code).toBe(0);
	expect(none.out).toContain("No market lists NOPE");
	expect((await invoke(["market"])).err).toContain("Usage: mob market <BASE>");
});

test("scan --by price ranks mark gaps widest first and filters like the funding scan", async () => {
	const body = JSON.parse(
		(
			await invoke([
				"scan",
				"--by",
				"price",
				"--include-thin",
				"--all-pairs",
				"--json",
			])
		).out,
	);
	expect(body.by).toBe("price");
	expect(body.priceBasis).toBe("mark");
	const gaps = body.view.anywhere.map((row: { gapPct: number }) => row.gapPct);
	expect(gaps).toEqual([...gaps].sort((a: number, b: number) => b - a));
	for (const row of body.view.anywhere) {
		expect(row.gapPct).toBeGreaterThan(0);
		expect(row.gapAfterFeesPct).toBeCloseTo(
			row.gapPct - row.roundTripFeePct,
			10,
		);
	}
	const dex = JSON.parse(
		(
			await invoke([
				"scan",
				"--by",
				"price",
				"--kind",
				"dex",
				"--include-thin",
				"--all-pairs",
				"--json",
			])
		).out,
	);
	const cex = new Set([
		"binance",
		"bybit",
		"okx",
		"mexc",
		"bingx",
		"bitget",
		"gate",
	]);
	for (const row of dex.view.anywhere)
		expect(cex.has(row.long.venue) || cex.has(row.short.venue)).toBe(false);
	const anchored = JSON.parse(
		(
			await invoke([
				"scan",
				"--anchor",
				"hl",
				"--include-thin",
				"--all-pairs",
				"--json",
			])
		).out,
	);
	expect(anchored.view.anywhere.length).toBeGreaterThan(0);
	for (const row of anchored.view.anywhere)
		expect([row.long.venue, row.short.venue]).toContain("hl");
	const rwa = JSON.parse(
		(await invoke(["scan", "--rwa", "--include-thin", "--all-pairs", "--json"]))
			.out,
	);
	for (const row of rwa.view.anywhere)
		expect(["NVDA", "OPENAI", "ANTHROPIC", "XYZ100", "XAU", "AAPL"]).toContain(
			row.base,
		);
	const minOi = JSON.parse(
		(
			await invoke([
				"scan",
				"--min-oi",
				"1",
				"--include-thin",
				"--all-pairs",
				"--json",
			])
		).out,
	);
	for (const row of minOi.view.anywhere) {
		expect(row.long.openInterestUsd).toBeGreaterThanOrEqual(1);
		expect(row.short.openInterestUsd).toBeGreaterThanOrEqual(1);
	}
	expect((await invoke(["scan", "--by", "basis"])).err).toContain(
		"--by must be funding or price",
	);
	expect((await invoke(["scan", "--anchor", "kraken"])).err).toContain(
		"--anchor must be one of",
	);
	const human = await invoke(["scan", "--by", "price"]);
	expect(human.out).toContain("Price gaps from mark prices");
	expect(human.out).toContain("long (cheap)");
});

test("watch saves public pairs in the mob home, reads them live, and removes them by number", async () => {
	const empty = await invoke(["watch"]);
	expect(empty.out).toContain("No saved pairs");
	const added = await invoke([
		"watch",
		"add",
		"btc",
		"--long",
		"lighter:BTC",
		"--short",
		"hl:BTC",
	]);
	expect(added.code).toBe(0);
	expect(added.out).toContain(
		"Saved pair 1: BTC long lighter:BTC, short hl:BTC",
	);
	expect(
		(
			await invoke([
				"watch",
				"add",
				"BTC",
				"--long",
				"lighter:BTC",
				"--short",
				"hl:BTC",
			])
		).out,
	).toContain("already saved");
	const file = join(home, "watchlist.json");
	expect((await stat(file)).mode & 0o777).toBe(0o600);
	expect(JSON.parse(await readFile(file, "utf8")).pairs).toHaveLength(1);
	const listed = JSON.parse((await invoke(["watch", "--json"])).out);
	expect(listed.view[0]).toMatchObject({
		base: "BTC",
		long: "lighter:BTC",
		short: "hl:BTC",
		found: true,
	});
	expect(typeof listed.view[0].spreadAnnualizedPct).toBe("number");
	expect(typeof listed.view[0].priceGapPct).toBe("number");
	expect(
		(
			await invoke([
				"watch",
				"add",
				"BTC",
				"--long",
				"kraken:BTC",
				"--short",
				"hl:BTC",
			])
		).err,
	).toContain("Invalid venues");
	expect(
		(await invoke(["watch", "add", "BTC", "--long", "hl", "--short", "hl:BTC"]))
			.err,
	).toContain("--long must be venue:market");
	expect((await invoke(["watch", "remove", "2"])).err).toContain(
		"Usage: mob watch remove <1-1>",
	);
	// Saving the pair again with a threshold sets its alert; --check prints it.
	expect(
		(
			await invoke([
				"watch",
				"add",
				"BTC",
				"--long",
				"lighter:BTC",
				"--short",
				"hl:BTC",
				"--alert-spread-above=-1000",
				"--alert-gap-above",
				"1000",
			])
		).out,
	).toContain("Updated the alert");
	const alerting = JSON.parse((await invoke(["watch", "--json"])).out);
	expect(alerting.view[0].alert).toEqual({
		spreadAbove: -1000,
		gapAbove: 1000,
	});
	expect(alerting.alerts).toBe(1);
	expect(alerting.view[0].triggered).toEqual([
		expect.stringMatching(/^funding spread -?\d+\.\d{2}%\/yr is above -1000%$/),
	]);
	const check = await invoke(["watch", "--check"]);
	expect(check.out).toMatch(
		/^ALERT 1 BTC \(long lighter:BTC, short hl:BTC\): funding spread/,
	);
	expect((await invoke(["watch"])).out).toContain(
		"spread > -1000%, gap > 1000%",
	);
	expect((await invoke(["watch", "--alert-gap-above", "1"])).err).toContain(
		"Usage: mob watch [--check]",
	);
	expect((await invoke(["watch", "remove", "1"])).out).toContain("Removed BTC");
	expect((await invoke(["watch", "--check"])).out).toContain("No saved pairs");
	expect(JSON.parse(await readFile(file, "utf8")).pairs).toEqual([]);
});

test("cost walks each venue's recorded book for every size and ranks the middle size", async () => {
	const recorded = books as {
		file: string;
		url: string;
		method: string;
		body?: string;
	}[];
	const { ctx } = await fixtureContext();
	// Snapshot fixtures for the listings; recorded books for the depth.
	const fetch = async (url: string, init?: RequestInit) => {
		const same = (item: { url: string; method: string; body?: unknown }) =>
			item.url === url &&
			item.method === (init?.method ?? "GET") &&
			JSON.stringify(item.body) === init?.body;
		if (snapshots.some(same)) return ctx.fetch(url, init);
		const book = recorded.find(
			(item) =>
				item.url === url &&
				item.method === (init?.method ?? "GET") &&
				item.body === init?.body,
		);
		if (!book) return ctx.fetch(url, init);
		return Response.json(
			await Bun.file(
				new URL(
					`../../../packages/funding/fixtures/${book.file}`,
					import.meta.url,
				),
			).json(),
		);
	};
	const result = await invoke(
		["cost", "btc", "--size", "1000,5000", "--json"],
		{
			fetch,
		},
	);
	expect(result.code).toBe(0);
	const body = JSON.parse(result.out);
	expect(body).toMatchObject({
		ticker: "BTC",
		side: "long",
		sizes: [1_000, 5_000],
	});
	const venues = body.view.map((row: { venue: string }) => row.venue);
	for (const venue of [
		"hl",
		"binance",
		"okx",
		"gate",
		"mexc",
		"grvt",
		"lighter-mainnet",
	])
		expect(venues).toContain(venue);
	expect(body.bookless).toEqual(["variational:BTC-PERP"]);
	// Coin-margined OKX BTC-USD-SWAP is not costed in USD.
	expect(
		body.view.some((row: { market: string }) => row.market === "BTC-USD-SWAP"),
	).toBe(false);
	const middle = body.view
		.map((row: { costs: { costBps?: number }[] }) => row.costs[1].costBps)
		.filter((value: number | undefined) => value !== undefined);
	expect(middle).toEqual([...middle].sort((a: number, b: number) => a - b));
	for (const row of body.view)
		for (const fill of row.costs)
			if (fill.complete)
				expect(fill.costBps).toBeCloseTo(
					fill.slippageBps + row.takerFeeBps,
					10,
				);
	const short = JSON.parse(
		(await invoke(["cost", "BTC", "--side", "short", "--json"], { fetch })).out,
	);
	expect(short.side).toBe("short");
	expect(short.sizes).toEqual([10_000, 100_000, 1_000_000]);
	const human = await invoke(["cost", "BTC"], { fetch });
	expect(human.out).toContain("cost $10K");
	expect(human.out).toContain("BTC · buy (long) by market order");
	expect(human.out).toContain("no public order book: variational:BTC-PERP");
	expect((await invoke(["cost", "BTC", "--side", "up"])).err).toContain(
		"--side must be long or short",
	);
	expect((await invoke(["cost", "BTC", "--size", "1,2,3,4,5"])).err).toContain(
		"one to four USD sizes",
	);
	expect((await invoke(["cost"])).err).toContain("Usage: mob cost <BASE>");
});
