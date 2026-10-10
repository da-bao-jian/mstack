import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import historyRows from "../../../packages/funding/fixtures/hyperliquid/history.json";
import { fixtureContext } from "../../../packages/funding/test/fixtures.ts";
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
	const client = new Client({ name: "mobstack-test", version: "0.1.0" });
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

test("MCP tools/list pins names, read-only descriptions, and input schemas", async () => {
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
	]);
	for (const tool of result.tools) {
		expect(
			tool.description?.endsWith(
				"Read-only. This tool never signs, trades, or holds keys.",
			),
		).toBe(true);
		expect(tool.annotations?.readOnlyHint).toBe(true);
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
		args: { venue: "hl", market: "BTC" },
		cli: ["rates", "--venue", "hl", "--market", "BTC", "--json"],
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
			expect(body.opportunities).toHaveLength(29);
			expect(body.view.anywhere).toHaveLength(2);
			expect(body.view.executable).toHaveLength(1);
			expect(body.holdDays).toBe(30);
		} else expect(body.view[0].market).toBe("BTC");
	},
);

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
	const result = await call("funding_rates");
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
				"mobstack/0.1.0",
			);
			expect(new Headers(init?.headers).get("User-Agent")).toBe(
				"mobstack/0.1.0",
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
		expect(text(result)).toContain("mob config set owner");
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
	const { call, rt } = await connect(
		{
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
