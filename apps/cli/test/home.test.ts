import { afterAll, expect, test } from "bun:test";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderLogo } from "@mstack/brand";
import type { ObservedFundingRate, Snapshot } from "@mstack/funding";
import { createKeyStore } from "@mstack/keys";
import { ProposalStore } from "@mstack/proposals";
import pkg from "../package.json";
import { setConfig } from "../src/config.ts";
import { collectHome, type HomeData } from "../src/home-data.ts";
import { type Runtime, run } from "../src/run.ts";
import { homeApi, homeNow, homeOwner } from "./fixtures/home-api.ts";

const root = await mkdtemp(join(tmpdir(), "mstack-home-test-"));
afterAll(() => rm(root, { recursive: true, force: true }));
let sequence = 0;
function marketSnapshot(): Snapshot {
	const make = (
		venue: string,
		market: string,
		annualizedPct: number,
		volume24hUsd: number,
	): ObservedFundingRate => ({
		venue,
		market,
		ratePerInterval: annualizedPct / 100 / 8760,
		intervalHours: 1,
		annualizedPct,
		observedAt: homeNow,
		markPrice: 100,
		volume24hUsd,
		openInterestUsd: volume24hUsd / 2,
		priceChange24hPct: 1.2,
		source: "direct",
		annualizationMethod: "simple",
	});
	const rates = [
		make("hl", "BTC", -20, 20_000_000),
		make("lighter", "BTC", 80, 10_000_000),
		make("hl", "ETH", -10, 8_000_000),
		make("lighter", "ETH", 40, 6_000_000),
	];
	return {
		observedAt: homeNow,
		rates,
		listed: rates.map((row) => `${row.venue}:${row.market}`),
		failed: [],
		source: "direct",
		annualizationMethod: "simple",
	};
}
async function context(configured = true) {
	const home = join(root, String(sequence++));
	const fake = homeApi();
	if (configured) {
		await setConfig("owner", homeOwner, home);
		await setConfig("signer", "browser", home);
		await setConfig("api_base", `https://api-${sequence}.test`, home);
		await setConfig("auth_base", `https://auth-${sequence}.test`, home);
	}
	const lines: string[] = [],
		errors: string[] = [];
	const rt: Runtime = {
		home,
		now: () => homeNow,
		fetch: fake.fetch,
		env: { LANG: "en_US.UTF-8", HOME: root },
		isTTY: true,
		columns: 120,
		homeServices: {
			which: () => "/mock/tool",
			upgrade: async () => ({ state: "ok", value: { available: null } }),
			marketSnapshot: async () => marketSnapshot(),
		},
		out: (s) => lines.push(s),
		err: (s) => errors.push(s),
	};
	const invoke = async (args: string[]) => {
		lines.length = 0;
		errors.length = 0;
		const code = await run(args, rt);
		return { code, out: lines.join("\n"), err: errors.join("\n") };
	};
	return { home, fake, rt, invoke };
}
async function proposal(home: string, now = homeNow) {
	const store = new ProposalStore(home, () => now);
	const p = await store.stage({
		kind: "sign-text",
		owner: homeOwner,
		purpose: "Home fixture only",
		signing: { type: "text", message: "fixture message" },
		submit: {
			base: "https://funding.mob.exchange",
			route: "/api/arbitrage/close",
			body: { taskId: "1842", timestamp: Math.floor(now / 1000) },
			signatureField: "signature",
		},
		preflightPlan: {
			checks: [
				{
					route: "/api/binding/hl/credential",
					params: { ownerAddress: homeOwner },
					assertions: [{ path: ["bound"], equals: true }],
				},
			],
		},
	});
	return store.preview(p.id, async () => ({
		ok: true,
		checkedAt: now,
		checks: [{ route: "/api/binding/hl/credential", ok: true }],
	}));
}
test("no args home: live market, account standing and next action share the logo", async () => {
	const { invoke, fake } = await context();
	const r = await invoke([]);
	expect(r.code).toBe(0);
	expect(r.err).toBe("");
	expect(r.out).toContain(`mstack ${pkg.version} · 0x0000…0001`);
	expect(r.out).toContain("Top pairs  BTC");
	expect(r.out).toContain("Trending   BTC");
	expect(r.out).toMatch(
		/Onboarding legal accepted · (bound [\w, -]+|no venue bound) · key none/,
	);
	expect(r.out).toContain("You can    say in Claude Code or Codex");
	expect(r.out).toContain('"set up mstack"  to finish setup');
	expect(r.out).not.toContain("Next ");
	expect(r.out).toContain("live · 2 of 20 venues");
	expect(r.out.split("\n")[0].indexOf("mstack")).toBe(35);
	expect(fake.calls).toHaveLength(8);
	expect(fake.calls.every((c) => c.method === "GET")).toBe(true);
	expect(fake.calls.some((c) => c.url.includes("rebind-check"))).toBe(false);
});
test("a tiny negative price change rounds to +0.0%, never −0.0%", async () => {
	const { rt, invoke } = await context(false);
	const snapshot = marketSnapshot();
	for (const rate of snapshot.rates) rate.priceChange24hPct = -0.03;
	rt.homeServices = {
		...rt.homeServices,
		marketSnapshot: async () => snapshot,
	};
	const r = await invoke([]);
	expect(r.code).toBe(0);
	expect(r.out).toContain("price +0.0%");
	expect(r.out).not.toContain("−0.0%");
	expect(r.out).not.toContain("-0.0%");
});
// Snapshots must survive a version bump: the home screen prints the version.
const stable = (out: string) =>
	out.replaceAll(`mstack ${pkg.version}`, "mstack <version>");

test("80-column ASCII home snapshots cover fresh, running and cached states", async () => {
	const fresh = await context(false);
	fresh.rt.columns = 80;
	fresh.rt.isTTY = false;
	fresh.rt.stdoutIsTTY = false;
	expect(stable((await fresh.invoke([])).out)).toMatchSnapshot("fresh live");

	const onboarded = await context();
	await setConfig("key_store", "file", onboarded.home);
	const store = await createKeyStore({
		home: onboarded.home,
		selection: "file",
		env: {},
		apiBase: "https://api.test",
		now: () => homeNow,
	});
	await store.put(
		homeOwner,
		`mobius_01234567-89ab-cdef-0123-456789abcdef.${"ab".repeat(32)}`,
		{
			importedAt: homeNow,
			apiBase: "https://api.test",
			maxSizeUsd: 5000,
		},
	);
	onboarded.rt.columns = 80;
	onboarded.rt.isTTY = false;
	onboarded.rt.stdoutIsTTY = false;
	expect(stable((await onboarded.invoke([])).out)).toMatchSnapshot(
		"onboarded running",
	);

	const cached = await context(false);
	await cached.invoke([]);
	cached.rt.now = () => homeNow + 4 * 60_000;
	cached.rt.homeServices = {
		...cached.rt.homeServices,
		marketSnapshot: async () => ({
			...marketSnapshot(),
			rates: [],
			listed: [],
		}),
	};
	cached.rt.columns = 80;
	cached.rt.isTTY = false;
	cached.rt.stdoutIsTTY = false;
	expect(stable((await cached.invoke([])).out)).toMatchSnapshot(
		"unreachable cached",
	);
});
test("terminal under 72 columns stacks the 13-row logo above info", async () => {
	const { invoke, rt } = await context();
	rt.columns = 60;
	const { out } = await invoke(["hello", "--offline", "--plain"]);
	expect(out.split("\n").slice(0, 13)).toEqual(
		renderLogo({ size: 32, mode: "mono" }),
	);
	expect(out.split("\n")[14]).toBe(`mstack ${pkg.version} · 0x0000…0001`);
	expect(out).not.toContain("\x1b");
});
test("TTY home uses brand colors and the three-swatch palette only", async () => {
	const { invoke, rt } = await context(false);
	rt.env = { LANG: "en_US.UTF-8", COLORTERM: "truecolor" };
	const { out } = await invoke([]);
	expect(out).toContain("\x1b[38;2;2;123;176mmstack");
	expect(out).toContain("\x1b[38;2;246;96;71mTop pairs");
	expect(out).toContain("\x1b[38;2;127;216;255m─");
	expect(out).toContain("\x1b[48;2;127;216;255m  \x1b[0m sky");
	expect(out).toContain("\x1b[48;2;246;96;71m  \x1b[0m orange");
	expect(out).toContain("\x1b[48;2;2;123;176m  \x1b[0m navy");
	expect(out).not.toContain(" bg");
	expect(out).not.toContain("<mob-home>");
});
test("non-TTY home uses one marked ASCII block; flags still force their modes", async () => {
	const { invoke, rt } = await context();
	rt.isTTY = false;
	rt.stdoutIsTTY = false;
	const headless = await invoke(["hello", "--offline"]);
	expect(headless.out).toStartWith("<mob-home>\n");
	expect(headless.out).toEndWith("\n</mob-home>");
	expect(headless.out).toMatch(/^[\x20-\x7e\n]*$/);
	expect(headless.out.indexOf("</mob-home>")).toBeGreaterThan(
		headless.out.indexOf(`mstack ${pkg.version}`),
	);

	const plain = await invoke(["hello", "--offline", "--plain"]);
	expect(plain.out).toStartWith("<mob-home>\n");
	expect(plain.out).toContain("░");
	const ascii = await invoke(["hello", "--offline", "--ascii"]);
	expect(ascii.out).toStartWith("<mob-home>\n");
	expect(ascii.out).not.toContain("░");
});
test("big has 25 art rows; compact uses the 13-row home and offline makes no HTTP calls", async () => {
	const { invoke, fake } = await context();
	const compactOffline = await invoke([
		"hello",
		"--compact",
		"--ascii",
		"--offline",
	]);
	expect(compactOffline.out).toStartWith("<mob-home>\n");
	expect(compactOffline.out).toContain("You can    say in chat");
	expect(compactOffline.out).toContain('"set up mstack"  to finish setup');
	expect(compactOffline.out).not.toContain("Chat ");
	expect(compactOffline.out).not.toContain("sky  ");
	const big = await invoke(["--big", "--plain", "--offline"]);
	expect(big.out.split("\n").filter((line) => /[░▒█]/.test(line))).toHaveLength(
		25,
	);
	expect(fake.calls).toHaveLength(0);
	const compact = await invoke(["hello", "--compact", "--ascii"]);
	expect(compact.out).toContain("Top pairs");
	expect(compact.out).not.toContain("Owner");
	expect(fake.calls).toHaveLength(8);
});

test("no config Next setup and auth terms read; no owner-specific routes", async () => {
	const { invoke, fake } = await context(false);
	const r = await invoke(["--plain"]);
	// Research needs no account: the first offer is a scan, trading is optional.
	expect(r.out).toContain(
		"Trading    not set up · optional · research needs no account",
	);
	expect(r.out).not.toContain("Onboarding");
	// Policy and Next are noise before an account exists.
	expect(r.out).not.toContain("Policy");
	expect(r.out).not.toContain("Next ");
	expect(r.out).toContain("new account");
	// The opening screen is a two-column table of what to say and what to
	// run, by state, and one line on how to reach mstack from an agent.
	expect(r.out).toMatch(
		/You can {4}say in Claude Code or Codex +or run in a terminal/,
	);
	expect(r.out).toMatch(/"best funding now" +mob scan --size 1000/);
	expect(r.out).toMatch(/"set up mstack" {2}to trade +mob onboard/);
	expect(r.out).toMatch(/"history BTC" +mob history BTC --days 7/);
	expect(r.out).toContain(
		"Chat       /mstack:mob in Claude Code or $mob in Codex opens this menu",
	);
	expect(fake.calls.map((c) => new URL(c.url).pathname).sort()).toEqual([
		"/api/client-ip",
		"/legal/terms",
	]);
	const json = JSON.parse((await invoke(["hello", "--json"])).out);
	expect(json.menu.state).toBe("fresh");
	expect(json.menu.rows).toHaveLength(4);
});
test("configured but unbound Next bind; empty tasks and absent acceptance", async () => {
	const { invoke, fake } = await context();
	fake.state.bound = [];
	fake.state.tasks = false;
	fake.state.accepted = false;
	const { out } = await invoke(["hello"]);
	expect(out).toContain(
		"Onboarding legal not accepted · no venue bound · key none",
	);
	expect(out).toContain("Policy     manual");
	expect(out).toMatch(
		/You can {4}say in Claude Code or Codex +or run in a terminal/,
	);
	expect(out).toMatch(/"set up mstack" {2}to finish setup +mob onboard/);
});
test("mob menu prints the You can rows from local state with no network read", async () => {
	const { invoke, fake, home, rt } = await context();
	const text = await invoke(["menu"]);
	expect(text.code).toBe(0);
	expect(text.err).toBe("");
	// A person at a terminal gets the column headers, then the full menu
	// by section.
	const lines = text.out.split("\n");
	expect(lines[0]).toMatch(
		/^say in Claude Code or Codex +or run in a terminal$/,
	);
	expect(lines.filter((line) => / · /.test(line))).toEqual([
		"Find trades · funding arb, price gaps, RWA farms, watchlist",
		"Explore markets · all markets, one asset, venues, RWA",
		"Charts & costs · cost to trade, spread chart, funding history, WTI vs Brent",
		"Trade & account · finish the one-time setup to trade through MoB",
	]);
	expect(lines).toContainEqual(
		expect.stringMatching(/^"set up mstack" {2}to finish setup +mob onboard$/),
	);
	// A capturing preamble gets rows only, so YOU_CAN stays a plain list.
	rt.isTTY = false;
	rt.stdoutIsTTY = false;
	const captured = await invoke(["menu"]);
	expect(captured.out.split("\n")[0]).toMatch(
		/^"set up mstack" {2}to finish setup +mob onboard$/,
	);
	const p = await proposal(home);
	const json = JSON.parse((await invoke(["menu", "--json"])).out);
	expect(json.state).toBe("awaiting");
	expect(json.sections).toHaveLength(4);
	expect(json.sections[3].rows[0].run).toBe(`mob sign ${p.id}`);
	expect(json.rows[0]).toEqual({
		say: `sign ${p.id}`,
		note: "first",
		run: `mob sign ${p.id}`,
		about: `${p.id} waits for your signature`,
	});
	expect(fake.calls).toHaveLength(0);
});
test("JSON includes local Proposals and gives pending Proposal Next priority", async () => {
	const { invoke, home } = await context();
	const p = await proposal(home);
	const r = await invoke(["hello", "--offline", "--json"]);
	const data = JSON.parse(r.out) as HomeData;
	expect(data.proposals.value?.awaiting).toEqual([p.id]);
	expect(data.next).toBe(`mob sign ${p.id}`);
	expect(data.api.state).toBe("not checked");
	expect(data.config.path).toBe(join(home, "config.json"));
	expect(r.out).not.toContain("░");
	expect(r.out).not.toContain("\x1b");
});
test("expiry is evaluated at display time and does not rewrite Proposal files", async () => {
	const { rt, home } = await context();
	const p = await proposal(home, homeNow - 400000);
	const data = await collectHome(rt, { offline: true });
	expect(data.proposals.value).toEqual({ awaiting: [], expired: [p.id] });
	expect(
		JSON.parse(await readFile(join(home, "proposals", `${p.id}.json`), "utf8"))
			.status,
	).toBe("awaiting-signature");
});
test("one deadline returns partial results and aborts even if fetch ignores its signal", async () => {
	const { rt, fake } = await context();
	fake.state.hang = "/api/arbitrage/list";
	rt.homeServices = { ...rt.homeServices, networkBudgetMs: 100 };
	const start = performance.now();
	const data = await collectHome(rt);
	expect(performance.now() - start).toBeLessThan(600);
	expect(data.api.state).toBe("ok");
	expect(data.auth.state).toBe("ok");
	expect(data.tasks.state).toBe("not checked");
	expect(fake.calls.every((c) => c.signal?.aborted)).toBe(true);
});
test("bad API responses remain explicit and cannot masquerade as unbound/empty", async () => {
	const { rt, fake } = await context();
	fake.state.fail = "/api/client-ip";
	fake.state.malformed = "/api/binding/hl/credential";
	const data = await collectHome(rt);
	expect(data.api.state).toBe("unreachable");
	expect(data.api.error).toContain("503");
	expect(data.venues.hl.state).toBe("unreachable");
	expect(data.venues.hl.value).toBeUndefined();
});
test("invalid config reports failure without calling configured endpoints", async () => {
	const { invoke, home, fake } = await context();
	await writeFile(join(home, "config.json"), "broken");
	const r = await invoke(["doctor", "--json"]);
	const data = JSON.parse(r.out);
	expect(r.code).toBe(1);
	expect(
		data.checks.find((c: { name: string }) => c.name === "Config").status,
	).toBe("fail");
	expect(fake.calls).toHaveLength(0);
});
test("doctor passes healthy configured state with optional unbound venues", async () => {
	const { invoke, fake } = await context();
	const r = await invoke(["doctor", "--json"]);
	const data = JSON.parse(r.out);
	expect(r.code).toBe(0);
	expect(data.ok).toBe(true);
	expect(data.checks).toHaveLength(20);
	expect(fake.calls).toHaveLength(11);
	expect(
		data.checks.find((c: { name: string }) => c.name === "Venue aster"),
	).toMatchObject({ status: "fail", critical: false });
});
test("doctor fails readiness, legal, venue deposit/account and signer errors", async () => {
	const { invoke, fake, rt } = await context();
	fake.state.builderApproved = false;
	fake.state.accepted = false;
	fake.state.funded = false;
	fake.state.account = false;
	rt.homeServices = { ...rt.homeServices, which: () => null };
	const r = await invoke(["doctor", "--json"]);
	const data = JSON.parse(r.out);
	expect(r.code).toBe(1);
	for (const name of [
		"Signer",
		"Legal",
		"Venue hl",
		"HL deposit",
		"lighter account",
	])
		expect(
			data.checks.find((c: { name: string }) => c.name === name),
		).toMatchObject({ critical: true, status: "fail" });
});
test("doctor timeout skips critical reads and returns exit 1", async () => {
	const { invoke, rt, fake } = await context();
	fake.state.hang = "/legal/acceptance";
	rt.homeServices = { ...rt.homeServices, networkBudgetMs: 50 };
	const r = await invoke(["doctor", "--json"]);
	expect(r.code).toBe(1);
	expect(
		JSON.parse(r.out).checks.find((c: { name: string }) => c.name === "Auth")
			.status,
	).toBe("fail");
});
test("doctor passes on a fresh install: trading checks are optional until an owner is set", async () => {
	const { invoke } = await context(false);
	const r = await invoke(["doctor"]);
	expect(r.code).toBe(0);
	expect(r.out).toContain("✓ Research");
	for (const name of ["Config", "Owner", "Signer", "Legal", "Venue hl"])
		expect(r.out).toMatch(new RegExp(`^– ${name} .*\\(optional\\)$`, "m"));
	expect(r.out).toContain('say "set up mstack"');
	expect(r.out).not.toContain("✗");
	const json = JSON.parse((await invoke(["doctor", "--json"])).out);
	expect(json.ok).toBe(true);
	expect(
		json.checks.find((c: { name: string }) => c.name === "Owner"),
	).toMatchObject({ status: "skip", critical: false });
});
test("doctor fails a missing signer once an owner is set", async () => {
	const { invoke, home } = await context(false);
	await setConfig("owner", "0x0000000000000000000000000000000000000001", home);
	const r = await invoke(["doctor"]);
	expect(r.code).toBe(1);
	expect(r.out).toContain("✗ Signer");
	expect(r.out).toMatch(/^✓ Legal/m);
	expect(r.out).not.toContain("optional until you trade");
});
test("signer diagnostics require a regular 0600 keystore and never read its contents", async () => {
	const { rt, home } = await context();
	await setConfig("signer", "keystore", home);
	const check = async () =>
		(await collectHome(rt, { offline: true })).diagnostics.signer.usable;
	expect(await check()).toBe(false);
	await mkdir(join(home, "keystore"));
	const path = join(home, "keystore", `${homeOwner}.json`);
	await writeFile(path, "contents must not be read", { mode: 0o600 });
	expect(await check()).toBe(true);
	await chmod(path, 0o644);
	expect(await check()).toBe(false);
	await rm(path);
	await writeFile(join(home, "other"), "x", { mode: 0o600 });
	await symlink(join(home, "other"), path);
	expect(await check()).toBe(false);
});
test("WalletConnect project id and platform-specific browser opener", async () => {
	const { rt, home } = await context();
	await setConfig("signer", "walletconnect", home);
	expect(
		(await collectHome(rt, { offline: true })).diagnostics.signer.usable,
	).toBe(false);
	await setConfig("walletconnect_project_id", "0".repeat(32), home);
	expect(
		(await collectHome(rt, { offline: true })).diagnostics.signer.usable,
	).toBe(true);
	await setConfig("signer", "browser", home);
	for (const [platform, opener] of [
		["darwin", "open"],
		["linux", "xdg-open"],
		["win32", "cmd"],
	] as const) {
		rt.homeServices = {
			...rt.homeServices,
			platform,
			which: (command) => (command === opener ? "/tool" : null),
		};
		expect(
			(await collectHome(rt, { offline: true })).diagnostics.signer.detail,
		).toBe(`${opener} present`);
	}
});
test("upgrade and terminal ASCII output; help/version remain plain", async () => {
	const { invoke, rt } = await context();
	rt.homeServices = {
		...rt.homeServices,
		upgrade: async () => ({ state: "ok", value: { available: "abcdef0" } }),
	};
	const r = await invoke(["hello", "--ascii", "--offline"]);
	expect(r.out).toMatch(/^[\x20-\x7e\n]*$/);
	expect(r.out).toContain("Top pairs");
	expect((await invoke(["--help"])).out).toContain("mob doctor [--json]");
	expect((await invoke(["--version"])).out).toBe(pkg.version);
	for (const args of [
		["hello", "oops"],
		["hello", "--big", "--compact"],
		["hello", "--plain", "--ascii"],
		["--invalid"],
	])
		expect((await invoke(args)).code).toBe(1);
});

test("slow API is labeled, unreachable deadline is explicit, and venue reads still finish", async () => {
	const { rt, fake, invoke } = await context(false);
	const fast = rt.fetch;
	rt.fetch = async (url, init) => {
		if (url.includes("/api/client-ip")) await Bun.sleep(3100);
		return fast(url, init);
	};
	await invoke(["hello", "--plain"]);
	fake.state.hang = "/api/client-ip";
	rt.fetch = fast;
	rt.homeServices = { ...rt.homeServices, networkBudgetMs: 30 };
	const data = await collectHome(rt);
	expect(data.api.state).toBe("unreachable");
	expect(data.auth.state).toBe("ok");
}, 10_000);
