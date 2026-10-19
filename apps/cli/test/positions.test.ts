import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProposalStore } from "@mstack/proposals";
import { listKeystores } from "@mstack/signers";
import { metadataContext } from "../../../packages/funding/test/metadata-fixtures.ts";
import { setConfig } from "../src/config.ts";
import { run } from "../src/run.ts";
import {
	fakePositionServer,
	loopbackFetch,
} from "./fixtures/fake-funding-server.ts";
import { openFlow } from "./fixtures/open-flow.ts";

test("native HIP-3 and Aster USD1 markets survive staging unchanged", async () => {
	const home = await mkdtemp(join(tmpdir(), "mstack-native-open-"));
	const owner = "0x0000000000000000000000000000000000000001";
	const server = fakePositionServer(owner);
	const premium = await Bun.file(
		new URL(
			"../../../packages/funding/fixtures/aster/premiumIndex.json",
			import.meta.url,
		),
	).json();
	const funding = await Bun.file(
		new URL(
			"../../../packages/funding/fixtures/aster/fundingInfo.json",
			import.meta.url,
		),
	).json();
	// Explicit test mutations of recorded rows; no claim of a recorded NVDA listing.
	premium.push({ ...premium[2], symbol: "NVDAUSD1", markPrice: "180" });
	funding.push({ symbol: "NVDAUSD1", fundingIntervalHours: 8 });
	const metadata = await Bun.file(
		new URL(
			"../../../packages/funding/fixtures/aster/exchangeInfo.json",
			import.meta.url,
		),
	).json();
	metadata.symbols.push({
		...metadata.symbols[1],
		symbol: "NVDAUSD1",
		baseAsset: "NVDA",
	});
	const ctx = await metadataContext({
		"aster/exchangeInfo.json": metadata,
		"aster/premiumIndex.json": premium,
		"aster/fundingInfo.json": funding,
	});
	const lines: string[] = [];
	try {
		for (const [key, value] of [
			["owner", owner],
			["signer", "browser"],
			["api_base", server.base],
		])
			await setConfig(key, value, home);
		const invoke = (args: string[]) =>
			run(args, {
				home,
				out: (s) => lines.push(s),
				err: (s) => lines.push(s),
				fetch: (url, init) =>
					url.startsWith(server.base)
						? loopbackFetch(url, init)
						: ctx.fetch(url, init),
			});
		expect(
			await invoke([
				"open",
				"NVDA",
				"--long",
				"hl:xyz:NVDA",
				"--short",
				"aster:USD1:NVDA",
				"--size",
				"1000",
				"--max-spread-bps",
				"20000",
				"--protect",
				"off",
			]),
		).toBe(0);
		const p = await new ProposalStore(home).get("p-1");
		expect(p.submit.body).toMatchObject({
			longMarket: "xyz:NVDA",
			shortMarket: "USD1:NVDA",
		});
		expect(p.submit.body).not.toHaveProperty("liqProtectionPct");
		expect(lines.join("\n")).toContain(
			"Stopped before signing. To authorize, name p-1 and run mob sign p-1.",
		);
		expect(server.writes).toHaveLength(0);
		expect(
			await invoke([
				"open",
				"BTC",
				"--long",
				"hl:xyz:NVDA",
				"--short",
				"aster:USD1:BTC",
				"--size",
				"1000",
			]),
		).toBe(1);
		expect(await new ProposalStore(home).list()).toHaveLength(1);
		await setConfig("policy", "locked", home);
		expect(await invoke(["preview", "p-1"])).toBe(1);
		expect(
			(await new ProposalStore(home).get("p-1")).preflight?.checks.find(
				(c) => c.name === "config.policy",
			),
		).toMatchObject({ ok: false, error: "Wallet policy is locked" });
	} finally {
		server.stop();
		await rm(home, { recursive: true, force: true });
	}
}, 15_000);

test("open and all six manage routes recover signer and check every stored body field", async () => {
	const flow = await openFlow(() => {}, true);
	expect(flow.writes).toBe(9);
	expect(flow.proposals.every((p) => p.status === "submitted")).toBe(true);
	expect(
		flow.proposals.every((p) => p.expiresAt - p.createdAt === 300000),
	).toBe(true);
}, 60_000);

test("CLI failures stage nothing; readiness error is verbatim; snapshot is never recomputed at sign", async () => {
	const home = await mkdtemp(join(tmpdir(), "mstack-w10-cli-test-"));
	const password = crypto.randomUUID();
	const ctx = await metadataContext();
	let server: ReturnType<typeof fakePositionServer> | undefined;
	const lines: string[] = [];
	let venueReads = 0;
	let prompts = 0;
	const invoke = (args: string[]) =>
		run(args, {
			home,
			out: (s) => lines.push(s),
			err: (s) => lines.push(s),
			fetch: async (url, init) => {
				if (url.startsWith("http://127.0.0.1:"))
					return loopbackFetch(url, init);
				venueReads++;
				return ctx.fetch(url, init);
			},
			readSecret: async () => {
				prompts++;
				return password;
			},
		});
	try {
		expect(await invoke(["keystore", "create"])).toBe(0);
		const [owner] = await listKeystores(home);
		server = fakePositionServer(owner);
		for (const [key, value] of [
			["owner", owner],
			["signer", "keystore"],
		])
			expect(await invoke(["config", "set", key, value])).toBe(0);
		// api_base needs the human's terminal through the CLI; write it directly.
		await setConfig("api_base", server.base, home);
		const open = [
			"open",
			"BTC",
			"--long",
			"hl:BTC",
			"--short",
			"lighter-mainnet:BTC",
			"--size",
			"1000",
		];
		const store = new ProposalStore(home);
		for (const extra of [
			["--protect", "8"],
			["--max-spread-bps", "0.01"],
			["--leverage", "3"],
			["--margin", "cross"],
			["--yes"],
			["--private-key", "x"],
		]) {
			expect(await invoke([...open, ...extra])).toBe(1);
			expect(await store.list()).toEqual([]);
		}
		server.credentials.hl = { bound: false };
		expect(await invoke(open)).toBe(1);
		expect(await store.list()).toEqual([]);
		expect(await invoke(["status", "--readiness", "--json"])).toBe(1);
		expect(lines.join("\n")).toContain("not_bound");
		server.credentials.hl = {
			bound: true,
			agentAddress: owner,
			builderApproved: true,
		};
		server.rebindBlocked.add("hl");
		expect(await invoke(["status", "--readiness"])).toBe(0);
		expect(lines.join("\n")).toContain("rebind allowed");
		expect(await invoke(["status", "--readiness", "--json"])).toBe(0);
		expect(
			JSON.parse(lines.at(-1) ?? "[]").find(
				(r: { venue: string }) => r.venue === "hl",
			),
		).toMatchObject({ ready: true, rebindAllowed: false });
		// Four rows with a compact glossary stay small enough for one agent read.
		const readiness = lines.at(-1) ?? "[]";
		expect(Buffer.byteLength(readiness)).toBeLessThan(6_000);
		for (const row of JSON.parse(readiness))
			expect(Object.keys(row.glossary.fields).every((key) => key in row)).toBe(
				true,
			);
		expect(await invoke(open)).toBe(0);
		const p = await store.get("p-1");
		expect(p.submit.body.longPrice).toBe(82794);
		expect(p.submit.body.shortPrice).toBe(82779.4);
		expect(p.preflight?.ok).toBe(true);
		expect(prompts).toBe(2);
		const readsAtStaging = venueReads;
		expect(await invoke(["preview", "p-1"])).toBe(0);
		expect(venueReads).toBe(readsAtStaging);
		const raw =
			'{\n  "error": "Venue readiness check failed.",\n  "readiness": {"ready": false, "venues": [{"venue":"hl","ready":false,"issue":"key_invalid"}]}\n}';
		server.setReadinessFailure(raw);
		server.expect(p.submit.route, p.submit.body);
		expect(await invoke(["sign", "p-1"])).toBe(1);
		expect(venueReads).toBe(readsAtStaging);
		expect(lines).toContain(`mob: ${raw}`);
		expect(server.writes).toHaveLength(1);
		expect(server.errors).toEqual([]);
		expect((await store.get("p-1")).answer).toEqual(JSON.parse(raw));
		expect(await invoke(["sign", "p-1"])).toBe(1);
		expect(server.writes).toHaveLength(1);
	} finally {
		server?.stop();
		await rm(home, { recursive: true, force: true });
	}
}, 60_000);
