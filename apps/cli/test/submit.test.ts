import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKeyStore } from "@mstack/keys";
import { type CreateTask, StrategyApiClient } from "@mstack/mobius-api";
import { contentHash, ProposalStore } from "@mstack/proposals";
import { metadataContext } from "../../../packages/funding/test/metadata-fixtures.ts";
import {
	fakeStrategyApi,
	loopbackFetch as strategyFetch,
} from "../../../packages/mobius-api/test/fake-api.ts";
import {
	readRecord,
	serializeRecord,
} from "../../../packages/proposals/src/record.ts";
import { setConfig } from "../src/config.ts";
import { run } from "../src/run.ts";
import {
	fakePositionServer,
	loopbackFetch,
} from "./fixtures/fake-funding-server.ts";

const homes: string[] = [];
const servers: { stop(): void }[] = [];
afterEach(async () => {
	for (const server of servers.splice(0)) server.stop();
	await Promise.all(
		homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
	);
});

test("open stages an immutable api Proposal, submits once, and status uses the key", async () => {
	const home = await mkdtemp(join(tmpdir(), "mstack-submit-"));
	homes.push(home);
	const strategy = fakeStrategyApi();
	servers.push(strategy);
	const now = Date.now();
	const funding = fakePositionServer(strategy.owner.address, () => now);
	servers.push(funding);
	const metadata = await metadataContext();
	await setConfig("owner", strategy.owner.address, home);
	await setConfig("policy", "manual", home);
	await setConfig("key_store", "file", home);
	await setConfig("api_base", funding.base, home);
	await setConfig("strategy_api_base", strategy.base, home);
	await (await createKeyStore({ home, selection: "file" })).put(
		strategy.owner.address,
		strategy.key,
		{
			venues: ["hl", "lighter", "lighter-mainnet", "aster"],
			maxSizeUsd: 10_000,
			importedAt: now,
			verifiedAt: now,
			apiBase: strategy.base,
		},
	);
	const invoke = async (args: string[]) => {
		const out: string[] = [];
		const err: string[] = [];
		const code = await run(args, {
			home,
			now: () => now,
			fetch: async (url, init) => {
				const input = String(url);
				if (input.startsWith(strategy.base)) return strategyFetch(input, init);
				if (input.startsWith(funding.base)) return loopbackFetch(input, init);
				return metadata.fetch(input, init);
			},
			out: (line) => out.push(line),
			err: (line) => err.push(line),
		});
		return { code, out: out.join("\n"), err: err.join("\n") };
	};
	const auto = await invoke([
		"setup",
		"--owner",
		strategy.owner.address,
		"--signer",
		"browser",
		"--policy",
		"auto",
		"--no-legal",
	]);
	expect(auto.code).toBe(0);
	expect(auto.out).toContain(
		"Warning: policy auto lets the agent submit API-key Proposals inside the key's venue and size caps.",
	);
	const homeScreen = await invoke(["hello", "--plain", "--offline"]);
	expect(homeScreen.out).toContain(
		"Policy     auto · the agent may submit inside the key's caps",
	);

	const opened = await invoke([
		"open",
		"BTC",
		"--long",
		"hl:BTC",
		"--short",
		"lighter:BTC",
		"--size",
		"1000",
	]);
	expect(opened.code).toBe(0);
	expect(opened.out).toContain("Next: mob submit p-1");
	expect(opened.out).not.toContain("mob sign p-1");
	const store = new ProposalStore(home, () => now);
	const proposal = await store.get("p-1");
	expect(proposal.kind).toBe("api-submit");
	expect(proposal.status).toBe("awaiting-submission");
	expect(proposal.submit.route).toBe("/v1/delta-neutral/tasks");
	expect(proposal.submit.base).toBe(strategy.base);
	expect(proposal.submit.body).toEqual({
		longVenue: "hl",
		shortVenue: "lighter",
		longMarket: "BTC",
		shortMarket: "BTC",
		sizeUsd: 1000,
		minFundingApy: 0,
		maxSpreadBps: 50,
	});
	expect(proposal.submit.idempotencyKey).toMatch(/^p-1:[0-9a-f-]{36}$/);
	expect(proposal.preflight?.checks.at(-2)?.name).toBe("key.venues");
	expect(proposal.preflight?.checks.at(-1)?.name).toBe("key.maxSizeUsd");
	expect(
		await readFile(join(home, "proposals/p-1.json"), "utf8"),
	).not.toContain(strategy.key);

	const submitted = await invoke(["submit", "p-1"]);
	expect(submitted.err).toBe("");
	expect(submitted.code).toBe(0);
	expect(submitted.out).toContain(
		"accepted, not executed; `mob status` shows the worker state",
	);
	expect((await store.get("p-1")).status).toBe("submitted");
	const repeated = await invoke(["submit", "p-1"]);
	expect(repeated.code).toBe(1);
	expect(repeated.err).toContain("terminal");

	const status = await invoke(["status", "--json"]);
	expect(status.code).toBe(0);
	const parsed = JSON.parse(status.out);
	expect(parsed.source).toBe("api");
	expect(parsed.tasks).toHaveLength(1);
	expect(parsed.tasks[0].size_usd).toBe("1000");

	expect(
		(
			await invoke([
				"open",
				"BTC",
				"--long",
				"hl:BTC",
				"--short",
				"lighter:BTC",
				"--size",
				"1000",
			])
		).code,
	).toBe(0);
	strategy.rateLimitNext();
	const limited = await invoke(["submit", "p-2"]);
	expect(limited.code).toBe(1);
	expect(limited.err).toBe("mob: rate limited; Retry-After: 3 seconds");
	expect((await store.get("p-2")).status).toBe("failed");
	expect((await invoke(["submit", "p-2"])).err).toContain("terminal");

	await setConfig("policy", "manual", home);
	await setConfig("signer", "browser", home);
	const keyStore = await createKeyStore({ home, selection: "file" });
	await keyStore.delete(strategy.owner.address);
	const noKey = await invoke([
		"open",
		"BTC",
		"--long",
		"hl:BTC",
		"--short",
		"lighter:BTC",
		"--size",
		"1000",
	]);
	expect(noKey.code).toBe(0);
	expect(noKey.err).toContain("no key: run mob onboard");
	expect((await store.get("p-3")).kind).toBe("sign-text");
	await keyStore.put(strategy.owner.address, strategy.key, {
		venues: ["hl", "aster"],
		maxSizeUsd: 10_000,
		importedAt: now,
		apiBase: strategy.base,
	});
	const scopeFallback = await invoke([
		"open",
		"BTC",
		"--long",
		"hl:BTC",
		"--short",
		"lighter:BTC",
		"--size",
		"1000",
	]);
	expect(scopeFallback.code).toBe(0);
	expect(scopeFallback.err).toContain("key lacks venue lighter");
	expect((await store.get("p-4")).kind).toBe("sign-text");

	const stageApi = async (sizeUsd: number) => {
		const staged = await store.stage({
			kind: "api-submit",
			owner: strategy.owner.address,
			purpose: "error mapping fixture",
			signing: { type: "none" },
			submit: {
				base: strategy.base,
				route: "/v1/delta-neutral/tasks",
				body: {
					longVenue: "hl",
					shortVenue: "lighter",
					longMarket: "BTC",
					shortMarket: "BTC",
					sizeUsd,
				},
			},
			preflightPlan: {
				checks: [{ route: "staged", name: "fixture", detail: "checked" }],
			},
		});
		return store.preview(staged.id, async () => ({
			ok: true,
			checkedAt: now,
			checks: [
				{ route: "staged", name: "fixture", detail: "checked", ok: true },
			],
		}));
	};
	const rejectedKey = `mobius_11111111-1111-4111-8111-111111111111.${"11".repeat(32)}`;
	await keyStore.put(strategy.owner.address, rejectedKey, {
		importedAt: now,
		apiBase: strategy.base,
	});
	const rejected = await stageApi(1000);
	expect((await invoke(["submit", rejected.id])).err).toBe(
		"mob: key rejected; run `mob keys show`",
	);
	await keyStore.put(strategy.owner.address, strategy.key, {
		importedAt: now,
		apiBase: strategy.base,
	});
	const forbidden = await stageApi(20_000);
	expect((await invoke(["submit", forbidden.id])).err).toBe(
		"mob: Outside API key scope.",
	);
	const conflict = await stageApi(1000);
	const client = new StrategyApiClient({
		base: strategy.base,
		key: strategy.key,
		version: "test",
		fetch: strategyFetch,
	});
	await client.createTask(
		{ ...(conflict.submit.body as unknown as CreateTask), sizeUsd: 1001 },
		{ idempotencyKey: conflict.submit.idempotencyKey as string },
	);
	expect((await invoke(["submit", conflict.id])).err).toBe(
		"mob: Idempotency key reused with another body.",
	);
});

test("submit runs the preflight again, prints the request, and refuses a record changed after staging", async () => {
	const home = await mkdtemp(join(tmpdir(), "mstack-submit-recheck-"));
	homes.push(home);
	const strategy = fakeStrategyApi();
	servers.push(strategy);
	const now = Date.now();
	const owner = strategy.owner.address;
	const funding = "https://funding.example.test";
	await setConfig("owner", owner, home);
	await setConfig("policy", "manual", home);
	await setConfig("key_store", "file", home);
	await setConfig("api_base", funding, home);
	await (await createKeyStore({ home, selection: "file" })).put(
		owner,
		strategy.key,
		{
			venues: ["hl", "lighter"],
			maxSizeUsd: 10_000,
			importedAt: now,
			verifiedAt: now,
			apiBase: strategy.base,
		},
	);
	let bound = true;
	const posts: string[] = [];
	const invoke = async (args: string[]) => {
		const out: string[] = [];
		const err: string[] = [];
		const code = await run(args, {
			home,
			now: () => now,
			fetch: async (url, init) => {
				const input = String(url);
				if (input.startsWith(strategy.base)) {
					if (init?.method === "POST") posts.push(input);
					return strategyFetch(input, init);
				}
				if (input.startsWith(`${funding}/api/binding/hl/credential`))
					return Response.json(
						bound
							? { bound, agentAddress: owner, builderApproved: true }
							: { bound },
					);
				return new Response("unexpected route", { status: 500 });
			},
			out: (line) => out.push(line),
			err: (line) => err.push(line),
		});
		return { code, out, err: err.join("\n") };
	};
	const store = new ProposalStore(home, () => now);
	const facts = [
		{ route: "staged", name: "key.venues", detail: "covered · hl, lighter" },
		{ route: "staged", name: "key.maxSizeUsd", detail: "1000 <= 10000" },
	] as const;
	const stage = async () => {
		const staged = await store.stage({
			kind: "api-submit",
			owner,
			purpose: "Open BTC: long hl:BTC, short lighter:BTC, $1000 per leg",
			signing: { type: "none" },
			submit: {
				base: strategy.base,
				route: "/v1/delta-neutral/tasks",
				body: {
					longVenue: "hl",
					shortVenue: "lighter",
					longMarket: "BTC",
					shortMarket: "BTC",
					sizeUsd: 1000,
				},
			},
			preflightPlan: {
				checks: [
					{
						route: "/api/binding/hl/credential",
						name: "readiness.hl",
						params: { ownerAddress: owner },
						assertions: [{ path: ["bound"], equals: true }],
					},
					...facts,
				],
			},
		});
		return store.preview(staged.id, async () => ({
			ok: true,
			checkedAt: now,
			checks: [
				{ route: "/api/binding/hl/credential", name: "readiness.hl", ok: true },
				...facts.map((fact) => ({ ...fact, ok: true })),
			],
		}));
	};

	// An unchanged record passes again and shows the final request first.
	await stage();
	const sent = await invoke(["submit", "p-1"]);
	expect(sent.err).toBe("");
	expect(sent.code).toBe(0);
	expect(sent.out[0]).toBe(
		"Sending p-1: POST /v1/delta-neutral/tasks · long hl:BTC · short lighter:BTC · $1000 per leg",
	);
	expect(sent.out[1]).toContain("accepted, not executed");
	expect(posts).toHaveLength(1);

	// A same-user edit that re-derives the unkeyed hash is refused at submit.
	await stage();
	const path = join(home, "proposals/p-2.json");
	const record = readRecord(await readFile(path, "utf8"));
	record.submit.body = {
		...record.submit.body,
		sizeUsd: 4900,
		longVenue: "aster",
	};
	const {
		version: _version,
		status: _status,
		contentHash: _old,
		preflight: _preflight,
		...partial
	} = record;
	record.contentHash = contentHash(partial);
	await writeFile(path, serializeRecord(record), { mode: 0o600 });
	await writeFile(
		join(home, "proposals/p-2.intent"),
		`${record.contentHash}\n`,
		{ mode: 0o600 },
	);
	expect((await store.get("p-2")).status).toBe("awaiting-submission");
	const tampered = await invoke(["submit", "p-2"]);
	expect(tampered.code).toBe(1);
	expect(tampered.err).toContain(
		"p-2 no longer matches the request its preflight checked; nothing was sent",
	);
	expect(posts).toHaveLength(1);
	expect((await store.get("p-2")).status).toBe("awaiting-submission");

	// A readiness change after staging fails the repeated preflight.
	await stage();
	bound = false;
	const unready = await invoke(["submit", "p-3"]);
	expect(unready.code).toBe(1);
	expect(unready.err).toContain("p-3 failed its preflight again (readiness.hl");
	expect(posts).toHaveLength(1);
});
