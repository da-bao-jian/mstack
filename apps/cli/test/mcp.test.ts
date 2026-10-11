import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import historyRows from "../../../packages/funding/fixtures/hyperliquid/history.json";
import { fixtureContext } from "../../../packages/funding/test/fixtures.ts";
import pkg from "../package.json";
import type { Runtime } from "../src/commands/runtime.ts";
import { setConfig } from "../src/config.ts";
import { createMcpServer } from "../src/mcp.ts";
import { run } from "../src/run.ts";
import toolsList from "./fixtures/mcp-tools.json";
import task from "./fixtures/public-task.json";

const home = await mkdtemp(join(tmpdir(), "mob-mcp-test-"));
const cleanup: (() => Promise<unknown>)[] = [];
afterAll(async () => {
	for (const close of cleanup.reverse()) await close();
	await rm(home, { recursive: true, force: true });
});

async function connect(
	overrides: Partial<Runtime> = {},
	options: { timeoutMs?: number } = {},
) {
	const { ctx, calls } = await fixtureContext();
	const rt: Runtime = { fetch: ctx.fetch, now: ctx.now, home, ...overrides };
	const server = createMcpServer(rt, options);
	const client = new Client({ name: "mstack-test", version: "0.2.0" });
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	await client.connect(clientTransport);
	cleanup.push(async () => {
		await client.close();
		await server.close();
	});
	return {
		client,
		rt,
		calls,
		call: async (name: string, args: Record<string, unknown> = {}) =>
			(await client.callTool({ name, arguments: args })) as CallToolResult,
	};
}

function text(result: CallToolResult): string {
	expect(result.content).toHaveLength(1);
	const first = result.content[0];
	if (first.type !== "text") throw new Error("Expected text result");
	return first.text;
}

test("MCP tools/list pins names, staging annotations, and input schemas", async () => {
	const { client } = await connect();
	const result = await client.listTools();
	// An explicit snapshot path works for both direct and root-bridge test runs.
	expect<unknown>(result.tools).toEqual(toolsList);
	expect(result.tools.map((t) => t.name)).toEqual([
		"funding_scan",
		"funding_rates",
		"funding_history",
		"explain",
		"task_list",
		"task_get",
		"config_get",
		"propose_open",
		"propose_close",
		"propose_neutralize",
		"propose_resize",
		"propose_protect",
		"propose_auto_close",
		"propose_size_mismatch_close",
		"proposal_list",
		"proposal_get",
	]);
	for (const tool of result.tools) {
		const staging = tool.name.startsWith("propose_");
		expect(tool.description).toContain(
			staging
				? "Never signs, submits, or holds keys"
				: "Read-only. This tool never signs, trades, or holds keys.",
		);
		expect(tool.annotations?.readOnlyHint).toBe(!staging);
		expect(tool.annotations?.idempotentHint).toBe(!staging);
		expect(tool.inputSchema.additionalProperties).toBe(false);
	}
});

test.each([
	{
		tool: "funding_scan",
		args: { sizeUsd: 5000, top: 2, topExec: 1, holdDays: 30, allPairs: true },
		cli: [
			"scan",
			"--size",
			"5000",
			"--top",
			"2",
			"--top-exec",
			"1",
			"--hold-days",
			"30",
			"--all-pairs",
			"--json",
		],
	},
	{
		tool: "funding_rates",
		args: { venue: "hl" },
		cli: ["rates", "--venue", "hl", "--json"],
	},
])(
	"$tool returns the same fixture JSON as the CLI",
	async ({ tool, args, cli }) => {
		const { call, rt } = await connect();
		const result = await call(tool, args);
		expect(result.isError).not.toBe(true);
		const out: string[] = [];
		expect(
			await run([...cli], { ...rt, out: (s) => out.push(s), err: () => {} }),
		).toBe(0);
		const body = JSON.parse(text(result));
		expect(body).toEqual(JSON.parse(out[0]));
		expect(body.failed).toEqual([]);
		expect(body.annualizationMethod).toBe("simple");
		if (tool === "funding_scan") {
			expect(body).not.toHaveProperty("opportunities");
			expect(Buffer.byteLength(text(result))).toBeLessThan(100_000);
			expect(Buffer.byteLength(out[0])).toBeLessThan(100_000);
			expect(body.counts.opportunities).toBe(29);
			expect(body.view.anywhere).toHaveLength(2);
			expect(body.view.executable).toHaveLength(1);
			expect(body.holdDays).toBe(30);
		} else expect(body.view[0].market).toBe("BTC");
	},
);

test("funding_scan defaults stay under 100 KB and includeFull explicitly adds the full array", async () => {
	const { call, rt } = await connect();
	const defaultResult = await call("funding_scan");
	expect(defaultResult.isError).not.toBe(true);
	const bounded = JSON.parse(text(defaultResult));
	expect(bounded).not.toHaveProperty("opportunities");
	expect(Buffer.byteLength(text(defaultResult))).toBeLessThan(100_000);
	const out: string[] = [];
	expect(
		await run(["scan", "--json"], {
			...rt,
			out: (s) => out.push(s),
			err: () => {},
		}),
	).toBe(0);
	expect(JSON.parse(out[0])).toEqual(bounded);
	expect(Buffer.byteLength(out[0])).toBeLessThan(100_000);
	const full = await call("funding_scan", { includeFull: true });
	expect(full.isError).not.toBe(true);
	const { opportunities, ...summary } = JSON.parse(text(full));
	expect(opportunities).toHaveLength(29);
	expect(summary).toEqual(bounded);
	const fullOut: string[] = [];
	expect(
		await run(["scan", "--json-full"], {
			...rt,
			out: (s) => fullOut.push(s),
			err: () => {},
		}),
	).toBe(0);
	expect(JSON.parse(fullOut[0])).toEqual(JSON.parse(text(full)));
});

test.each(["top", "topExec"])(
	"funding_scan caps %s at 200 even with includeFull",
	async (key) => {
		const { call, calls } = await connect();
		for (const value of [201, 1e30]) {
			const result = await call("funding_scan", {
				[key]: value,
				includeFull: true,
			});
			expect(result.isError).toBe(true);
			expect(text(result)).toContain("capped at 200");
		}
		expect(calls).toHaveLength(0);
		expect((await call("funding_scan", { [key]: 200 })).isError).not.toBe(true);
	},
);

test("funding_rates requires venue or market and market-only requests bound every raw array", async () => {
	const { call, calls, rt } = await connect();
	const missing = await call("funding_rates");
	expect(missing.isError).toBe(true);
	expect(text(missing)).toBe(
		"mob: funding_rates requires at least one of venue or market",
	);
	expect(calls).toHaveLength(0);
	const result = await call("funding_rates", { market: "BTC" });
	expect(result.isError).not.toBe(true);
	const body = JSON.parse(text(result));
	expect(body.view.length).toBeGreaterThan(0);
	expect(body.rates).toHaveLength(body.view.length);
	expect(body.listed).toEqual(
		body.view.map(
			(r: { venue: string; market: string }) => `${r.venue}:${r.market}`,
		),
	);
	const out: string[] = [];
	expect(
		await run(["rates", "--market", "BTC", "--json"], {
			...rt,
			out: (s) => out.push(s),
			err: () => {},
		}),
	).toBe(0);
	const cli = JSON.parse(out[0]);
	expect(cli.view).toEqual(body.view);
	expect(cli.rates.length).toBeGreaterThan(body.rates.length);
	expect(cli.failed).toEqual(body.failed);
	expect(cli.unmatched).toEqual(body.unmatched);
	const unfiltered: string[] = [];
	expect(
		await run(["rates", "--json"], {
			...rt,
			out: (s) => unfiltered.push(s),
			err: () => {},
		}),
	).toBe(0);
	expect(JSON.parse(unfiltered[0]).rates).toEqual(cli.rates);
});

test("explain returns bundled markdown, topic list, and a tool error for an unknown topic", async () => {
	const { call, calls } = await connect();
	expect(
		text(await call("explain", { topic: "funding", simple: true })),
	).toContain("Funding is a payment");
	expect(text(await call("explain", { topic: "funding" }))).toContain(
		"## Precise",
	);
	expect(text(await call("explain"))).toContain("Topics:");
	const unknown = await call("explain", { topic: "missing" });
	expect(unknown.isError).toBe(true);
	expect(text(unknown)).toContain("mob: Unknown topic missing. Topics:");
	expect(calls).toHaveLength(0);
});

test("funding_history uses recorded history and reports unsupported venues", async () => {
	const { ctx } = await fixtureContext();
	const { call, rt } = await connect({
		now: () => 1791637459597,
		fetch: async (url, init) => {
			if (url.includes("hyperliquid") && init?.body) {
				const body = JSON.parse(String(init.body));
				if (body.type === "fundingHistory") {
					expect(body.coin).toBe("BTC");
					return Response.json(
						historyRows.filter(
							(r) => r.time >= body.startTime && r.time <= body.endTime,
						),
					);
				}
			}
			return ctx.fetch(url, init);
		},
	});
	const result = await call("funding_history", {
		base: "BTC",
		days: 3,
		venues: ["hl", "lighter"],
	});
	expect(result.isError).not.toBe(true);
	const body = JSON.parse(text(result));
	expect(body.history[0].sampleCount).toBe(5);
	expect(body.unsupported).toEqual([
		{ venue: "lighter", reason: "no keyless history" },
	]);
	expect(body.failed).toEqual([]);
	const out: string[] = [];
	expect(
		await run(
			["history", "BTC", "--days", "3", "--venues", "hl,lighter", "--json"],
			{
				...rt,
				out: (s) => out.push(s),
				err: () => {},
			},
		),
	).toBe(0);
	expect(body).toEqual(JSON.parse(out[0]));
});

test("partial venue failures remain visible alongside usable rates", async () => {
	const { ctx } = await fixtureContext();
	const { call } = await connect({
		fetch: (url, init) =>
			url.includes("hyperliquid")
				? Promise.resolve(new Response("unavailable", { status: 503 }))
				: ctx.fetch(url, init),
	});
	const result = await call("funding_rates", { market: "BTC" });
	expect(result.isError).not.toBe(true);
	const body = JSON.parse(text(result));
	expect(body.rates.length).toBeGreaterThan(0);
	expect(body.failed).toHaveLength(1);
	expect(body.failed[0].venue).toBe("hl");
	expect(body.failed[0].error).toContain("503");
	expect(body.rates.some((row: { venue: string }) => row.venue === "hl")).toBe(
		false,
	);
});

test("task_get returns all publicTask fields with the configured owner and client headers", async () => {
	const configured = await mkdtemp(join(home, "owner-"));
	await setConfig("owner", task.owner, configured);
	const { call } = await connect({
		home: configured,
		fetch: async (url, init) => {
			const params = new URL(url).searchParams;
			expect(params.get("owner")).toBe(task.owner);
			expect(params.get("taskId")).toBe("1842");
			expect(new Headers(init?.headers).get("X-Mobius-Client")).toBe(
				`mstack/${pkg.version}`,
			);
			expect(new Headers(init?.headers).get("User-Agent")).toBe(
				`mstack/${pkg.version}`,
			);
			return Response.json(task);
		},
	});
	const result = await call("task_get", { taskId: "1842" });
	expect(result.isError).not.toBe(true);
	expect(JSON.parse(text(result)).tasks).toEqual([task]);
});

test("missing owner is a tool error naming the same config command as the CLI", async () => {
	const { call, calls, rt } = await connect();
	for (const name of ["task_list", "task_get"]) {
		const result = await call(
			name,
			name === "task_get" ? { taskId: "1842" } : {},
		);
		expect(result.isError).toBe(true);
		expect(text(result)).toContain("Run `mob setup` first");
		const errors: string[] = [];
		await run(["status", ...(name === "task_get" ? ["--task", "1842"] : [])], {
			...rt,
			out: () => {},
			err: (s) => errors.push(s),
		});
		expect(text(result)).toBe(errors[0]);
	}
	expect(calls).toHaveLength(0);
});

test("task_list and request errors preserve the public read contract", async () => {
	const { call } = await connect({
		fetch: async (url) => {
			expect(new URL(url).pathname).toBe("/api/arbitrage/list");
			return Response.json([task]);
		},
	});
	expect(
		JSON.parse(text(await call("task_list", { owner: task.owner }))).tasks,
	).toEqual([task]);
	const failing = await connect({
		fetch: async () => new Response("denied", { status: 403 }),
	});
	const result = await failing.call("task_get", {
		taskId: "1842",
		owner: task.owner,
	});
	expect(result.isError).toBe(true);
	expect(text(result)).toContain("HTTP 403");
	expect(text(result)).toContain("denied");
});

test("config_get is read-only and no config_set tool or extra argument is accepted", async () => {
	const { call, calls } = await connect();
	expect(text(await call("config_get", { key: "default_size_usd" }))).toBe(
		"1000",
	);
	expect(text(await call("config_get", { key: "api_base" }))).toBe(
		"https://funding.mob.exchange",
	);
	for (const [name, args] of [
		["config_set", { key: "owner", value: task.owner }],
		["config_get", { key: "owner", value: task.owner }],
		["config_get", { key: "unknown" }],
	] as const)
		expect((await call(name, args)).isError).toBe(true);
	await expect(readFile(join(home, "config.json"))).rejects.toThrow();
	expect(calls).toHaveLength(0);
});

test("invalid tool arguments fail before reading a venue", async () => {
	const { call, calls } = await connect();
	for (const [name, args] of [
		["funding_scan", { sizeUsd: 0 }],
		["funding_scan", { sizeUsd: "1000" }],
		["funding_scan", { holdDays: -1 }],
		["funding_history", {}],
		["task_get", { owner: task.owner }],
		["funding_rates", { venue: "unknown" }],
	] as const)
		expect((await call(name, args)).isError).toBe(true);
	expect(calls).toHaveLength(0);
});

test("the tool deadline aborts stalled requests and is returned as a tool error", async () => {
	let aborted = false;
	// An independent host gives this request the first rate-limit slot.
	const deadlineHome = await mkdtemp(join(tmpdir(), "mob-deadline-test-"));
	cleanup.push(() => rm(deadlineHome, { recursive: true, force: true }));
	await setConfig("api_base", "https://deadline.invalid", deadlineHome);
	const { call, rt } = await connect(
		{
			home: deadlineHome,
			fetch: async (_url, init) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						"abort",
						() => {
							aborted = true;
							reject(init.signal?.reason);
						},
						{ once: true },
					);
				}),
		},
		{ timeoutMs: 20 },
	);
	const result = await call("task_get", { owner: task.owner, taskId: "1842" });
	expect(result.isError).toBe(true);
	expect(text(result)).toBe("mob: Tool timed out after 20ms");
	expect(aborted).toBe(true);
	expect(() => createMcpServer(rt, { timeoutMs: 60_001 })).toThrow();
});

test("global network remains disabled with the MCP SDK loaded", async () => {
	expect(() =>
		globalThis.fetch("https://funding.mob.exchange/api/client-ip"),
	).toThrow("Network disabled in tests");
});

test("MCP stages all seven routes, returns exact stored views, and cannot sign or reject", async () => {
	const { ProposalStore } = await import("@mstack/proposals");
	const { metadataContext } = await import(
		"../../../packages/funding/test/metadata-fixtures.ts"
	);
	const { readyCredentials } = await import(
		"./fixtures/fake-funding-server.ts"
	);
	const ctx = await metadataContext();
	const stagingHome = await mkdtemp(join(home, "propose-"));
	const now = Date.now();
	await setConfig("owner", task.owner, stagingHome);
	await setConfig("signer", "browser", stagingHome);
	await setConfig("api_base", "http://127.0.0.1:19341", stagingHome);
	const requests: string[] = [];
	const credentials = readyCredentials(task.owner, now);
	const { call, rt } = await connect({
		home: stagingHome,
		now: () => now,
		fetch: async (url, init) => {
			if (!url.startsWith("http://127.0.0.1:19341"))
				return ctx.fetch(url, init);
			const u = new URL(url);
			requests.push(`${init?.method} ${u.pathname}`);
			expect(init?.method).toBe("GET");
			if (u.pathname === "/api/arbitrage/task") return Response.json(task);
			if (u.pathname === "/api/binding/hl/credential")
				return Response.json(credentials.hl);
			if (u.pathname === "/api/binding/lighter/credential")
				return Response.json(credentials.lighter);
			throw new Error(`Unexpected request: ${url}`);
		},
	});
	const store = new ProposalStore(stagingHome, () => now);
	const cases = [
		[
			"propose_open",
			{
				base: "BTC",
				long: "hl:BTC",
				short: "lighter:BTC",
				sizeUsd: 1000,
				protect: 8,
				assumeLeverage: "3",
				autoClose: false,
				minApy: 2,
				maxSpreadBps: 40,
				sizeMismatch: 5,
			},
			"create",
		],
		["propose_close", { taskId: "1842" }, "close"],
		["propose_resize", { taskId: "1842", long: 0.06, short: 0.06 }, "resize"],
		["propose_neutralize", { taskId: "1842" }, "neutralize"],
		["propose_protect", { taskId: "1842", pct: 6 }, "liq-protection"],
		[
			"propose_auto_close",
			{ taskId: "1842", enabled: true, minApy: 10 },
			"auto-close",
		],
		[
			"propose_size_mismatch_close",
			{ taskId: "1842", enabled: false, pct: 5 },
			"size-mismatch-auto-close",
		],
	] as const;
	for (const [name, args, route] of cases) {
		const result = await call(name, args);
		expect(result.isError).not.toBe(true);
		const { proposal: view, message } = JSON.parse(text(result));
		const stored = await store.get(view.id);
		expect(view).toMatchObject({
			id: stored.id,
			purpose: stored.purpose,
			owner: stored.owner,
			status: "awaiting-signature",
			digest: stored.digest,
			signing: stored.signing,
			submit: stored.submit,
			expiresAt: now - (now % 1000) + 300_000,
			preflight: stored.preflight,
		});
		expect(view.submit.route).toBe(`/api/arbitrage/${route}`);
		expect(view).not.toHaveProperty("signature");
		expect(stored.signatureAttemptedAt).toBeUndefined();
		expect(stored.preflight?.ok).toBe(true);
		expect(message).toBe(
			`Nothing is signed or sent until a human runs \`mob sign ${stored.id}\`.`,
		);
		const before = await readFile(
			join(stagingHome, "proposals", `${stored.id}.json`),
			"utf8",
		);
		expect(
			JSON.parse(text(await call("proposal_get", { id: stored.id }))),
		).toEqual({ proposal: view, message });
		expect(
			await readFile(
				join(stagingHome, "proposals", `${stored.id}.json`),
				"utf8",
			),
		).toBe(before);
	}
	const opened = await store.get("p-1");
	expect(opened.submit.body).toEqual({
		longVenue: "hl",
		longMarket: "BTC",
		shortVenue: "lighter",
		shortMarket: "BTC",
		sizeUsd: 1000,
		longPrice: 82794,
		shortPrice: 82773.5,
		minFundingApy: 2,
		autoClose: false,
		maxSpreadBps: 40,
		liqProtectionPct: 8,
		sizeMismatchPct: 5,
		timestamp: Math.floor(now / 1000),
		nonce: expect.any(String),
	});
	expect((await store.get("p-3")).submit.body).toEqual({
		taskId: "1842",
		timestamp: Math.floor(now / 1000),
		longTargetBase: 0.06,
		shortTargetBase: 0.06,
	});
	expect((await store.get("p-5")).submit.body).toEqual({
		taskId: "1842",
		timestamp: Math.floor(now / 1000),
		liqProtectionPct: 6,
	});
	expect((await store.get("p-6")).submit.body).toEqual({
		taskId: "1842",
		timestamp: Math.floor(now / 1000),
		autoClose: true,
		minFundingApy: 10,
	});
	expect((await store.get("p-7")).submit.body).toEqual({
		taskId: "1842",
		timestamp: Math.floor(now / 1000),
		enabled: false,
		thresholdPct: 0,
	});
	const count = requests.length;
	const listed = JSON.parse(text(await call("proposal_list")));
	expect(listed.proposals).toHaveLength(7);
	for (const item of listed.proposals)
		expect(item).toEqual(
			JSON.parse(text(await call("proposal_get", { id: item.proposal.id }))),
		);
	expect(requests).toHaveLength(count);
	expect(
		requests.some((r) => r.includes("rebind-check") || r.startsWith("POST")),
	).toBe(false);
	for (const name of [
		"sign",
		"proposal_sign",
		"reject",
		"proposal_reject",
		"config_set",
	])
		expect((await call(name, { id: "p-1" })).isError).toBe(true);
	await expect(
		readFile(join(stagingHome, "proposals/p-1.signature-used")),
	).rejects.toThrow();
	// The shared CLI path builds the same manage intent without an MCP-specific builder.
	const out: string[] = [];
	expect(
		await run(["protect", "1842", "6"], {
			...rt,
			out: (s) => out.push(s),
			err: (s) => out.push(s),
		}),
	).toBe(0);
	const cli = await store.get("p-8");
	expect(cli.signing).toEqual((await store.get("p-5")).signing);
	expect(cli.submit).toEqual((await store.get("p-5")).submit);
	await setConfig("policy", "locked", stagingHome);
	const locked = await call("propose_close", { taskId: "1842" });
	expect(locked.isError).toBe(true);
	expect(text(locked)).toContain("config.policy");
	expect(await store.list()).toHaveLength(8);
}, 20_000);

test("proposal tools reject malformed input, missing config, missing ids and expired task state", async () => {
	const fresh = await mkdtemp(join(home, "invalid-propose-"));
	const { call, calls } = await connect({ home: fresh });
	for (const [name, args] of [
		["propose_open", { base: "BTC", long: "hl:BTC", short: "lighter:BTC" }],
		[
			"propose_open",
			{
				base: "BTC",
				long: "hl:BTC",
				short: "lighter:BTC",
				sizeUsd: 1000,
				yes: true,
			},
		],
		["propose_resize", { taskId: "1842", long: "1" }],
		["propose_protect", { taskId: "1842", pct: "on" }],
		["propose_auto_close", { taskId: "1842", enabled: "on" }],
		["propose_size_mismatch_close", { taskId: "1842", enabled: false }],
		["proposal_get", { id: "../config" }],
		["proposal_get", { id: "p-999" }],
		["proposal_list", { reject: true }],
		["propose_close", { taskId: "1842" }],
	] as const)
		expect((await call(name, args)).isError).toBe(true);
	expect(JSON.parse(text(await call("proposal_list"))).proposals).toEqual([]);
	expect(calls).toHaveLength(0);
	await setConfig("owner", task.owner, fresh);
	await setConfig("signer", "browser", fresh);
	await setConfig("api_base", "http://127.0.0.1:19342", fresh);
	const closed = await connect({
		home: fresh,
		fetch: async () => Response.json({ ...task, status: "closed" }),
	});
	const result = await closed.call("propose_close", { taskId: "1842" });
	expect(result.isError).toBe(true);
	expect(text(result)).toContain("task.status");
	expect(
		JSON.parse(text(await closed.call("proposal_list"))).proposals,
	).toEqual([]);
});
