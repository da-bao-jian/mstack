import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKeyStore } from "@mstack/keys";
import {
	type CreateTask,
	IdempotencyConflict,
	StrategyApiClient,
} from "@mstack/mobius-api";
import { ProposalStore } from "@mstack/proposals";
import { metadataContext } from "../../../packages/funding/test/metadata-fixtures.ts";
import {
	fakeStrategyApi,
	loopbackFetch as strategyFetch,
} from "../../../packages/mobius-api/test/fake-api.ts";
import { setConfig } from "../src/config.ts";
import { run } from "../src/run.ts";
import {
	fakePositionServer,
	loopbackFetch,
} from "../test/fixtures/fake-funding-server.ts";

const home = await mkdtemp(join(tmpdir(), "mstack-smoke-submit-"));
const now = Date.now();
const strategy = fakeStrategyApi();
const funding = fakePositionServer(strategy.owner.address, () => now);
const metadata = await metadataContext();
const lines: string[] = [];
const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
	const input = String(url);
	if (input.startsWith(strategy.base)) return strategyFetch(input, init);
	if (input.startsWith(funding.base)) return loopbackFetch(input, init);
	return metadata.fetch(input, init);
};
const command = async (args: string[], expected = 0) => {
	lines.push(`$ mob ${args.join(" ")}`);
	const code = await run(args, {
		home,
		now: () => now,
		fetch: fetcher,
		out: (line) => lines.push(line),
		err: (line) => lines.push(line),
	});
	lines.push(`exit=${code}`);
	assert.equal(code, expected);
};

try {
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
	const open = [
		"open",
		"BTC",
		"--long",
		"hl:BTC",
		"--short",
		"lighter:BTC",
		"--size",
		"1000",
	];
	await command(open);
	const store = new ProposalStore(home, () => now);
	const proposal = await store.get("p-1");
	await command(["submit", "p-1"]);
	const submitted = await store.get("p-1");
	await command(["status"]);
	const client = new StrategyApiClient({
		base: strategy.base,
		key: strategy.key,
		version: "smoke",
		fetch: strategyFetch,
	});
	const replay = await client.createTask(
		proposal.submit.body as unknown as CreateTask,
		{ idempotencyKey: proposal.submit.idempotencyKey as string },
	);
	assert.equal(replay.taskId, (submitted.answer as { taskId: string }).taskId);
	await assert.rejects(
		client.createTask(
			{ ...(proposal.submit.body as unknown as CreateTask), sizeUsd: 1001 },
			{ idempotencyKey: proposal.submit.idempotencyKey as string },
		),
		IdempotencyConflict,
	);
	await command(open);
	strategy.rateLimitNext();
	await command(["submit", "p-2"], 1);
	assert(lines.some((line) => line.includes("Retry-After: 3 seconds")));
	console.log(lines.join("\n"));
	console.log(
		"smoke:submit passed · open → 202 → API status · replay stable · changed body 409 · 429 stopped",
	);
} finally {
	funding.stop();
	strategy.stop();
	await rm(home, { recursive: true, force: true });
}
