import { afterAll, expect, test } from "bun:test";
import {
	chmod,
	mkdir,
	mkdtemp,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderLogo } from "@mstack/brand";
import { ProposalStore } from "@mstack/proposals";
import pkg from "../package.json";
import { setConfig } from "../src/config.ts";
import { collectHome, type HomeData } from "../src/home-data.ts";
import { type Runtime, run } from "../src/run.ts";
import { homeApi, homeNow, homeOwner } from "./fixtures/home-api.ts";

const root = await mkdtemp(join(tmpdir(), "mstack-home-test-"));
afterAll(() => rm(root, { recursive: true, force: true }));
let sequence = 0;
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
		isTTY: false,
		columns: 120,
		homeServices: {
			which: () => "/mock/tool",
			upgrade: async () => ({ state: "ok", value: { available: null } }),
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
test("no args home: parallel reads, aligned info, statuses, owner, tasks and Next", async () => {
	const { invoke, fake } = await context();
	const r = await invoke([]);
	expect(r.code).toBe(0);
	expect(r.err).toBe("");
	expect(r.out).toContain(`mstack ${pkg.version}  ·  mob`);
	expect(r.out).toContain("Owner     0x0000…0001");
	expect(r.out).toContain("hl ✓  lighter ✓  aster –  lighter-mainnet –");
	expect(r.out).toContain("Legal     accepted 2026-08-17");
	expect(r.out).toContain("Tasks     2 running · 1 closed");
	expect(r.out).toEndWith("Next  mob scan --size 1000");
	expect(r.out.split("\n")[0].indexOf("mstack")).toBe(47);
	for (const label of [
		"API",
		"Auth",
		"Owner",
		"Signer",
		"Policy",
		"Legal",
		"Venues",
		"Tasks",
		"Proposals",
		"Config",
		"Upgrade",
	])
		expect(
			r.out
				.split("\n")
				.find((line) => line.includes(`${label} `))
				?.indexOf(label),
		).toBe(47);
	expect(fake.calls).toHaveLength(7);
	expect(fake.calls.every((c) => c.method === "GET")).toBe(true);
	expect(fake.calls.some((c) => c.url.includes("rebind-check"))).toBe(false);
});
test("narrow terminal stacks logo above info; plain has no escapes", async () => {
	const { invoke, rt } = await context();
	rt.columns = 89;
	const { out } = await invoke(["hello", "--offline", "--plain"]);
	expect(out.split("\n").slice(0, 18)).toEqual(
		renderLogo({ size: 44, mode: "mono" }),
	);
	expect(out.split("\n")[19]).toBe(`mstack ${pkg.version}  ·  mob`);
	expect(out).not.toContain("\x1b");
});
test("big and compact sizes retain Next; offline makes no HTTP calls", async () => {
	const { invoke, fake } = await context();
	expect(
		(await invoke(["hello", "--compact", "--ascii", "--offline"])).out,
	).toBe(
		[
			...renderLogo({ size: 32, mode: "ascii" }),
			"",
			".. -- ++ ##",
			"",
			"Next  mob bind hl",
		].join("\n"),
	);
	const big = await invoke(["--big", "--plain", "--offline"]);
	expect(big.out.split("\n")[0].indexOf("mstack")).toBe(63);
	expect(big.out).toContain("not checked");
	expect(fake.calls).toHaveLength(0);
	const compact = await invoke(["hello", "--compact", "--ascii"]);
	expect(compact.out).toEndWith("Next  mob scan --size 1000");
	expect(compact.out).not.toContain("Owner");
	expect(fake.calls).toHaveLength(7);
});

test("no config Next setup and auth terms read; no owner-specific routes", async () => {
	const { invoke, fake } = await context(false);
	const r = await invoke(["--plain"]);
	expect(r.out).toEndWith("Next  mob setup");
	expect(r.out).toContain("not set → run mob setup");
	expect(fake.calls.map((c) => new URL(c.url).pathname).sort()).toEqual([
		"/api/client-ip",
		"/legal/terms",
	]);
});
test("configured but unbound Next bind; empty tasks and absent acceptance", async () => {
	const { invoke, fake } = await context();
	fake.state.bound = [];
	fake.state.tasks = false;
	fake.state.accepted = false;
	const { out } = await invoke(["hello"]);
	expect(out).toContain("Tasks     none");
	expect(out).toContain("Legal     not accepted");
	expect(out).toEndWith("Next  mob bind hl");
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
	expect((await new ProposalStore(home).get(p.id)).status).toBe(
		"awaiting-signature",
	);
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
	expect(data.checks).toHaveLength(18);
	expect(fake.calls).toHaveLength(10);
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
	).toBe("skip");
});
test("doctor text, no config and missing owner", async () => {
	const { invoke } = await context(false);
	const r = await invoke(["doctor"]);
	expect(r.code).toBe(1);
	expect(r.out).toContain("✗ Config");
	expect(r.out).toContain("✗ Owner");
	expect(r.out).toContain("– Legal");
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
	expect(r.out).toContain("available abcdef0");
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
