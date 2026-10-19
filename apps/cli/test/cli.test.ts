import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureContext } from "../../../packages/funding/test/fixtures.ts";
import pkg from "../package.json";
import { configHome } from "../src/config.ts";
import { knowledge } from "../src/knowledge.ts";
import { type Runtime, run } from "../src/run.ts";
import task from "./fixtures/public-task.json";

const home = await mkdtemp(join(tmpdir(), "mob-cli-test-"));
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

test("scan JSON contains bounded views and counts without all ranked rows", async () => {
	const result = await invoke([
		"scan",
		"--json",
		"--size",
		"5000",
		"--top",
		"2",
	]);
	expect(result.code).toBe(0);
	const body = JSON.parse(result.out);
	expect(body).not.toHaveProperty("opportunities");
	expect(Buffer.byteLength(result.out)).toBeLessThan(100_000);
	expect(Object.keys(body).sort()).toEqual([
		"annualizationMethod",
		"counts",
		"failed",
		"glossary",
		"holdDays",
		"observedAt",
		"source",
		"unmatched",
		"view",
	]);
	expect(body.counts.opportunities).toBe(155);
	expect(body.view.anywhere).toHaveLength(2);
	expect(
		new Set(body.view.anywhere.map((r: { base: string }) => r.base)).size,
	).toBe(2);
	expect(
		body.view.executable.every((r: { executable: boolean }) => r.executable),
	).toBe(true);
	expect(
		[...body.view.anywhere, ...body.view.executable].every(
			(r: { sizeUsd: number }) => r.sizeUsd === 5000,
		),
	).toBe(true);
	expect(result.err).toContain("annualized = simple, not compounded");
	expect(result.err).toContain("unmatched: 0");
});

test("scan json-full opts into all opportunities and retains the bounded counts and views", async () => {
	const bounded = await invoke(["scan", "--json", "--top", "1"]);
	const full = await invoke(["scan", "--json-full", "--top", "1"]);
	expect(full.code).toBe(0);
	const {
		opportunities,
		glossary: fullGlossary,
		...body
	} = JSON.parse(full.out);
	expect(opportunities).toHaveLength(155);
	const { glossary: boundedGlossary, ...boundedBody } = JSON.parse(bounded.out);
	expect(body).toEqual(boundedBody);
	expect(fullGlossary.venues).toEqual(boundedGlossary.venues);
	expect(body.counts.qualifying).toBe(
		opportunities.filter((r: { qualifies: boolean }) => r.qualifies).length,
	);
	expect(body.counts.executable).toBe(
		opportunities.filter((r: { executable: boolean }) => r.executable).length,
	);
	expect(body.counts.unmatched).toBe(body.unmatched.length);
	const raw = JSON.parse((await invoke(["rates", "--json"])).out);
	expect(body.counts.rates).toBe(raw.rates.length);
	expect(full.err).toBe(bounded.err);
});

test.each(["--top", "--top-exec"])(
	"scan caps %s at 200 before any fetch, including full JSON",
	async (flag) => {
		for (const value of ["201", "1e30"]) {
			const result = await invoke(["scan", "--json-full", flag, value]);
			expect(result.code).toBe(1);
			expect(result.err).toContain(`${flag.slice(2)} is capped at 200`);
			expect(result.calls).toHaveLength(0);
		}
		expect((await invoke(["scan", "--json", flag, "200"])).code).toBe(0);
	},
);

test("scan filters venues, base, execution, and annualized spread before top", async () => {
	const result = await invoke([
		"scan",
		"--venues",
		"hl,lighter",
		"--market",
		"btc",
		"--all-pairs",
		"--executable",
		"--min-apy=0",
		"--json",
	]);
	const body = JSON.parse(result.out);
	expect(body.view.executable).toHaveLength(1);
	expect(body.view.anywhere).toEqual([]);
	expect(body.view.executable[0].base).toBe("BTC");
	expect(body.view.executable[0].executable).toBe(true);
	expect(
		result.calls.every(
			(c) => c.url.includes("hyperliquid") || c.url.includes("rh.lighter"),
		),
	).toBe(true);
});

test("rates preserve native rows and add hourly values", async () => {
	const result = await invoke([
		"rates",
		"--venue",
		"hl",
		"--market",
		"BTC",
		"--json",
	]);
	const body = JSON.parse(result.out);
	expect(result.code).toBe(0);
	expect(body.view).toHaveLength(1);
	expect(body.view[0].market).toBe("BTC");
	expect(body.view[0].ratePerHour).toBe(body.view[0].ratePerInterval);
	expect(result.err).toContain("source: direct");
});

test("human scan includes costs, execution flags, and footer even when empty", async () => {
	const result = await invoke(["scan", "--market", "NO_MATCH"]);
	expect(result.code).toBe(0);
	for (const word of [
		"break-even h",
		"entry (mark est.)",
		"net APY",
		"Executable on Mobius",
		"Best anywhere",
		"vol24h",
		"OI (long/short)",
		"thin hidden: 0",
		"EXEC",
		"flags",
		"snapshot age:",
		"failed: none",
		"unmatched:",
	])
		expect(result.out).toContain(word);
});

test("venue failures are visible and strict changes exit status", async () => {
	const { ctx } = await fixtureContext({
		"lighter/robinhood.json": new Response("down", { status: 503 }),
	});
	for (const strict of [false, true]) {
		const result = await invoke(
			[
				"scan",
				"--venues",
				"hl,lighter",
				...(strict ? ["--strict"] : []),
				"--json",
			],
			{ fetch: ctx.fetch },
		);
		expect(result.code).toBe(strict ? 3 : 0);
		expect(JSON.parse(result.out).failed[0].venue).toBe("lighter");
		expect(result.err).toContain("HTTP 503");
	}
	const none = await invoke(["rates", "--venue", "lighter", "--strict"], {
		fetch: async () => new Response("down", { status: 503 }),
	});
	expect(none.code).toBe(2);
	expect(none.out).toContain("failed: lighter");
});

test.each(
	[
		["scan", "--size", "0"],
		["scan", "--top", "1.5"],
		["scan", "--min-apy", "NaN"],
		["scan", "--venues", "unknown"],
		["rates", "--venue", ""],
		["scan", "--private-key", "x"],
		["open"],
		["history"],
		["history", "BTC", "--days", "0"],
		["explain", "../PRD"],
		["status", "--owner", "invalid"],
		["status", "--owner", task.owner, "--trims"],
		["config", "get", "unknown"],
		["config", "set", "owner", "0x123"],
		["scan", "--min-volume", "-1"],
		["scan", "--hold-days", "0"],
		["scan", "--top-exec", "1.5"],
		["config", "set", "default_size_usd", "NaN"],
		["config", "set", "api_base", "file:///tmp"],
		["config", "set", "app_base", "file:///tmp"],
		["scan", "extra"],
	].map((args) => ({ args })),
)("usage fails before any network: %j", async ({ args }) => {
	const result = await invoke(args);
	expect(result.code).toBe(1);
	expect(result.calls).toHaveLength(0);
});

test("protected config keys need the human's terminal and a typed yes", async () => {
	const gateHome = await mkdtemp(join(tmpdir(), "mob-config-gate-"));
	try {
		const set = (key: string, value: string, overrides: Partial<Runtime>) =>
			invoke(["config", "set", key, value], { home: gateHome, ...overrides });
		const get = async (key: string) =>
			(await invoke(["config", "get", key], { home: gateHome })).out;
		// An agent shell has no TTY; a scripted "yes" never reaches the prompt.
		const agent: Partial<Runtime> = {
			stdinIsTTY: false,
			stdoutIsTTY: false,
			readSecret: async () => "yes",
		};
		for (const [key, value] of [
			["policy", "auto"],
			["api_base", "https://example.test"],
			["strategy_api_base", "https://example.test"],
			["auth_base", "https://example.test"],
			["app_base", "https://example.test"],
			["key_store", "file"],
			["walletconnect_project_id", "0123456789abcdef0123456789abcdef"],
		]) {
			const result = await set(key, value, agent);
			expect(result.code).toBe(1);
			expect(result.err).toContain(
				`mob config set ${key} needs your own terminal`,
			);
		}
		expect(
			(await set("policy", "auto", { ...agent, stdinIsTTY: true })).code,
		).toBe(1);
		expect(
			(await set("policy", "auto", { ...agent, stdoutIsTTY: true })).code,
		).toBe(1);
		expect(await get("policy")).toBe("manual");
		const prompts: string[] = [];
		const human = { stdinIsTTY: true, stdoutIsTTY: true };
		const declined = await set("policy", "auto", {
			...human,
			readSecret: async (prompt) => {
				prompts.push(prompt);
				return "y";
			},
		});
		expect(declined.code).toBe(1);
		expect(declined.err).toContain("policy unchanged");
		expect(prompts).toEqual([
			"Type yes and press Enter to set policy to auto (input is hidden): ",
		]);
		expect(await get("policy")).toBe("manual");
		const accepted = await set("policy", "auto", {
			...human,
			readSecret: async () => "yes",
		});
		expect(accepted.code).toBe(0);
		expect(await get("policy")).toBe("auto");
		// Ordinary preferences still work from any shell.
		expect((await set("default_size_usd", "5000", agent)).code).toBe(0);
		expect(await get("default_size_usd")).toBe("5000");
	} finally {
		await rm(gateHome, { recursive: true, force: true });
	}
});

test("mob upgrade refuses an agent shell without a terminal", async () => {
	const result = await invoke(["upgrade"], { stdinIsTTY: false });
	expect(result.code).toBe(1);
	expect(result.err).toContain("mob upgrade needs your own terminal");
	expect(result.calls).toHaveLength(0);
});

test("version and help expose only delivered commands", async () => {
	expect((await invoke(["--version"])).out).toBe(pkg.version);
	const result = await invoke(["--help"]);
	for (const name of [
		"scan",
		"rates",
		"history",
		"explain",
		"status",
		"config",
	])
		expect(result.out).toContain(`mob ${name}`);
	for (const name of [
		"open",
		"close",
		"neutralize",
		"resize",
		"protect",
		"auto-close",
		"size-mismatch-close",
	])
		expect(result.out).toContain(`mob ${name}`);
	expect(result.out).toContain("mob setup");
	expect(result.out).toContain("mob onboard");
	expect(result.out).toContain("mob bind <hl|aster|lighter|lighter-mainnet>");
	expect(result.out).not.toContain("--leverage");
	expect(result.out).not.toContain("--margin");
	expect(result.out).toContain("mob sign <id>");
	expect(result.calls).toHaveLength(0);
});

test("every knowledge topic has Simple and Precise sections and is available offline", async () => {
	for (const [topic, text] of Object.entries(knowledge)) {
		expect(text).toContain("## Simple");
		expect(text).toContain("## Precise");
		const simple = await invoke(["explain", topic, "--simple"]);
		expect(simple.code).toBe(0);
		expect(simple.out).not.toContain("## Precise");
		expect(simple.calls).toHaveLength(0);
	}
	expect((await invoke(["explain"])).out).toContain("distance-to-liquidation");
	const unknown = await invoke(["explain", "missing"]);
	expect(unknown.code).toBe(1);
	expect(unknown.err).toContain("Topics:");
});

test("config stores only allowed settings at mode 0600 and affects scans", async () => {
	const isolated = await mkdtemp(join(tmpdir(), "mob-config-test-"));
	try {
		for (const [key, value] of [
			["default_size_usd", "5000"],
			["taker_fee_bps.hl", "1"],
			["builder_fee_tenths_bps", "0"],
			["api_base", "https://funding.mob.exchange"],
		]) {
			// api_base is protected: the human's terminal confirms it.
			expect(
				(
					await invoke(["config", "set", key, value], {
						home: isolated,
						stdinIsTTY: true,
						stdoutIsTTY: true,
						readSecret: async () => "yes",
					})
				).code,
			).toBe(0);
			expect(
				(await invoke(["config", "get", key], { home: isolated })).out,
			).toBe(value);
		}
		expect((await stat(join(isolated, "config.json"))).mode & 0o777).toBe(
			0o600,
		);
		const result = await invoke(["scan", "--venues", "hl,lighter", "--json"], {
			home: isolated,
		});
		const [row] = JSON.parse(result.out).view.executable;
		expect(row.sizeUsd).toBe(5000);
		expect(row.roundTripFeePct).toBe(0.02);
		expect(row.builderFeePct).toBe(0);
		await writeFile(join(isolated, "config.json"), "{bad");
		expect((await invoke(["scan"], { home: isolated })).code).toBe(1);
	} finally {
		await rm(isolated, { recursive: true, force: true });
	}
});

test("MOB_HOME controls the config directory", () => {
	const previous = process.env.MOB_HOME;
	try {
		process.env.MOB_HOME = home;
		expect(configHome()).toBe(home);
	} finally {
		if (previous === undefined) delete process.env.MOB_HOME;
		else process.env.MOB_HOME = previous;
	}
});

test("status renders every publicTask fixture field and sends client headers", async () => {
	const requests: { url: string; init?: RequestInit }[] = [];
	const result = await invoke(
		[
			"status",
			"--owner",
			task.owner,
			"--task",
			"1842",
			"--api-base",
			"https://funding.mob.exchange",
		],
		{
			fetch: async (url, init) => {
				requests.push({ url, init });
				return Response.json(task);
			},
		},
	);
	expect(result.code).toBe(0);
	for (const key of Object.keys(task).filter(
		(key) => !["task_id", "status"].includes(key),
	))
		expect(result.out).toContain(key);
	expect(result.out).toContain(`Position ${task.task_id} [${task.status}]`);
	expect(result.out).toContain("funding_usd (estimate)");
	expect(result.out).toContain(
		"api: https://funding.mob.exchange | fetched: 0.0s | tasks: 1",
	);
	expect(result.out).not.toContain("snapshot age");
	const headers = new Headers(requests[0].init?.headers);
	expect(headers.get("X-Mobius-Client")).toBe(`mstack/${pkg.version}`);
	expect(headers.get("User-Agent")).toBe(`mstack/${pkg.version}`);
	expect(requests[0].url).toContain("taskId=1842");
});

test("status empty list and errors never masquerade as tasks", async () => {
	expect(
		(
			await invoke(["status", "--owner", task.owner], {
				fetch: async () => Response.json([]),
			})
		).out,
	).toContain("No positions. Try `mob scan`.");
	for (const response of [
		new Response("denied", { status: 403 }),
		Response.json({ tasks: [] }),
		Response.json([{ ...task, auto_close: "true" }]),
		new Response("not json"),
	]) {
		const result = await invoke(["status", "--owner", task.owner], {
			fetch: async () => response.clone(),
		});
		expect(result.code).toBe(1);
		expect(result.err).toContain(`HTTP ${response.status}`);
		expect(result.err).toContain("body:");
	}
});

test("status paginates trim and resize logs with owner and task", async () => {
	const seen: string[] = [];
	const result = await invoke(
		[
			"status",
			"--owner",
			task.owner,
			"--task",
			"1842",
			"--trims",
			"--resizes",
			"--json",
		],
		{
			fetch: async (url) => {
				seen.push(url);
				const u = new URL(url);
				expect(u.searchParams.get("owner")).toBe(task.owner);
				expect(u.searchParams.get("taskId")).toBe("1842");
				if (u.pathname.endsWith("/task")) return Response.json(task);
				if (u.searchParams.has("cursor"))
					return Response.json({ attempts: [], nextCursor: null, total: 1 });
				const shared = {
					id: "2",
					attempted_at: task.updated_at,
					outcome: "done",
					steps: [],
					error: null,
				};
				return Response.json({
					attempts: [
						u.pathname.endsWith("/resizes")
							? {
									...shared,
									mode: "resize",
									target_long: 0.04,
									target_short: 0.04,
								}
							: {
									...shared,
									threshold_pct: 8,
									breached_leg: "long",
									breached_dist_pct: 7,
									action: "trim",
								},
					],
					nextCursor: "2",
					total: 1,
				});
			},
		},
	);
	expect(result.code).toBe(0);
	expect(seen).toHaveLength(5);
	const body = JSON.parse(result.out);
	expect(body.trims).toHaveLength(1);
	expect(body.resizes).toHaveLength(1);
	expect(result.err).toContain("tasks: 1 | trims: 1 | resizes: 1");
});

test("thin rows are hidden and counted before top, and can be included", async () => {
	const args = ["scan", "--min-volume", "1000000000000000", "--json"];
	const hidden = await invoke(args);
	const body = JSON.parse(hidden.out);
	expect(body.view).toEqual({ executable: [], anywhere: [] });
	expect(body.counts.thinHidden).toBe(155);
	expect(hidden.err).toContain("thin hidden: 155");
	const included = await invoke([...args, "--include-thin"]);
	// One row per base: BTC, ETH, ERA, and XTZ have more than one listing.
	expect(JSON.parse(included.out).view.anywhere).toHaveLength(4);
	expect(
		JSON.parse(included.out).view.anywhere.every((r: { flags: string[] }) =>
			r.flags.includes("thin"),
		),
	).toBe(true);
	expect(included.err).toContain("thin hidden: 0");
});

test("executable-only uses top, omits the EXEC column, and carries the hold horizon", async () => {
	const args = [
		"scan",
		"--executable",
		"--top",
		"1",
		"--top-exec",
		"5",
		"--hold-days",
		"30",
	];
	const result = await invoke([...args, "--json"]);
	const body = JSON.parse(result.out);
	expect(body.holdDays).toBe(30);
	expect(body.view.executable).toHaveLength(1);
	expect(body.view.anywhere).toEqual([]);
	const human = await invoke(args);
	expect(human.out).toContain("30-day hold");
	expect(human.out).not.toContain("Best anywhere");
	expect(human.out).not.toMatch(/\bEXEC\b/);
});

test("status defaults to the saved owner, permits an override, and names the unset key", async () => {
	const isolated = await mkdtemp(join(tmpdir(), "mob-owner-test-"));
	try {
		const absent = await invoke(["status"], { home: isolated });
		expect(absent.code).toBe(1);
		expect(absent.err).toContain("Run `mob setup` first");
		expect(
			(await invoke(["config", "get", "owner"], { home: isolated })).out,
		).toBe("");
		expect(
			(await invoke(["config", "set", "owner", task.owner], { home: isolated }))
				.code,
		).toBe(0);
		const override = "0x0000000000000000000000000000000000000001";
		for (const owner of [task.owner, override]) {
			const result = await invoke(
				["status", ...(owner === override ? ["--owner", owner] : [])],
				{
					home: isolated,
					fetch: async (url) => {
						expect(new URL(url).searchParams.get("owner")).toBe(owner);
						return Response.json([]);
					},
				},
			);
			expect(result.code).toBe(0);
			expect(result.out).toContain("tasks: 0");
		}
	} finally {
		await rm(isolated, { recursive: true, force: true });
	}
});
