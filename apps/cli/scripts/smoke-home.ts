import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProposalStore } from "@mstack/proposals";
import { fixtureContext } from "../../../packages/funding/test/fixtures.ts";
import { setConfig } from "../src/config.ts";
import { run } from "../src/run.ts";
import { homeApi, homeNow, homeOwner } from "../test/fixtures/home-api.ts";

// All requests, including the keyless venue reads, go to this loopback server.
const temporary = await mkdtemp(join(tmpdir(), "mstack-smoke-home-"));
const home = join(temporary, ".mob");
const fake = homeApi();
const venue = await fixtureContext();
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(req) {
		return fake.fetch(req.url, {
			method: req.method,
			headers: req.headers,
			redirect: "error",
			...(req.method === "POST" ? { body: await req.text() } : {}),
		});
	},
});
try {
	for (const [key, value] of Object.entries({
		owner: homeOwner,
		signer: "browser",
		api_base: server.url.origin,
		auth_base: server.url.origin,
	}))
		await setConfig(key, value, home);
	const store = new ProposalStore(home, () => homeNow);
	const p = await store.stage({
		kind: "sign-text",
		owner: homeOwner,
		purpose: "Home screen fixture; never signed",
		signing: { type: "text", message: "Home smoke preview only" },
		submit: {
			base: server.url.origin,
			route: "/api/arbitrage/close",
			body: { taskId: "1842", timestamp: Math.floor(homeNow / 1000) },
			signatureField: "signature",
		},
		preflightPlan: {
			checks: [
				{
					route: "staged",
					name: "fixture",
					detail: "No submission in this smoke",
				},
			],
		},
	});
	await store.preview(p.id, async () => ({
		ok: true,
		checkedAt: homeNow,
		checks: [{ route: "staged", name: "fixture", ok: true }],
	}));
	console.log(
		"Offline smoke: temporary config, local Proposal, loopback APIs; no wallet or venue writes.",
	);
	for (const args of [
		["--plain"],
		["hello", "--big", "--plain"],
		["doctor", "--json"],
	]) {
		console.log(`\n$ mob ${args.join(" ")}`);
		const started = performance.now();
		const output: string[] = [];
		const code = await run(args, {
			home,
			now: () => homeNow,
			isTTY: false,
			columns: 120,
			env: { HOME: temporary, LANG: "en_US.UTF-8" },
			homeServices: {
				which: () => "/fixture/tool",
				upgrade: async () => ({ state: "ok", value: { available: null } }),
			},
			fetch: async (url, init) => {
				const parsed = new URL(url);
				const body = typeof init?.body === "string" ? init.body : "";
				return parsed.hostname === server.url.hostname ||
					body.includes('"type":"clearinghouseState"') ||
					parsed.pathname === "/api/v1/account"
					? fetch(
							`${server.url.origin}${parsed.pathname}${parsed.search}`,
							init,
						)
					: venue.ctx.fetch(url, init);
			},
			out: (line) => {
				output.push(line);
				console.log(line);
			},
			err: console.error,
		});
		if (args[0] !== "doctor") {
			assert.ok(performance.now() - started < 5_500);
			assert.match(output.join("\n"), /<mob-home>\n[\s\S]*\n<\/mob-home>/);
		}
		console.log(`exit ${code}`);
		assert.equal(code, 0);
	}
	assert.equal(fake.calls.length, 24);
	assert.equal(fake.calls.filter((c) => c.method === "POST").length, 1);
	assert.ok(venue.calls.length > 0, "home must read recorded venue fixtures");
	console.log(
		"\n24 API reads; the only POST was keyless clearinghouseState. No signature requested.",
	);
} finally {
	await server.stop(true);
	await rm(temporary, { recursive: true, force: true });
}
