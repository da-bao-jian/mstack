import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageOpenBody } from "@mstack/mobius-client";
import { ProposalStore } from "@mstack/proposals";
import { listKeystores } from "@mstack/signers";
import { run } from "../src/run.ts";
import {
	fakeFundingServer,
	loopbackFetch,
} from "../test/fixtures/fake-funding-server.ts";

// Offline integration transcript. A random, disposable passphrase is supplied
// through the same reader injection used in tests; no argv or environment secrets.
const home = await mkdtemp(join(tmpdir(), "mstack-w7-smoke-"));
const passphrase = crypto.randomUUID();
let server: ReturnType<typeof fakeFundingServer> | undefined;
async function command(args: string[], expected = 0) {
	console.log(`$ mob ${args.join(" ")}`);
	const code = await run(args, {
		home,
		fetch: loopbackFetch,
		readSecret: async (prompt) => {
			console.log(`${prompt}[hidden; injected test reader]`);
			return passphrase;
		},
	});
	console.log(`exit=${code}`);
	assert.equal(code, expected);
}
try {
	await command(["keystore", "create"]);
	const [owner] = await listKeystores(home);
	await command(["config", "set", "owner", owner]);
	await command(["config", "set", "signer", "keystore"]);
	const staged = stageOpenBody({
		longVenue: "hl",
		longMarket: "BTC",
		shortVenue: "lighter",
		shortMarket: "BTC",
		sizeUsd: 1000,
		longPrice: 60000,
		shortPrice: 60000.5,
		autoClose: false,
		maxSpreadBps: 50,
	});
	server = fakeFundingServer(owner, staged.body);
	const store = new ProposalStore(home);
	const proposal = await store.stage({
		kind: "sign-text",
		owner,
		purpose: "W7 fake-server open; no live trading",
		signing: { type: "text", message: staged.message },
		submit: {
			base: server.base,
			route: "/api/arbitrage/create",
			body: staged.body,
			signatureField: "signature",
		},
		preflightPlan: {
			checks: [
				{
					route: "/api/binding/rebind-check",
					params: { ownerAddress: owner, venue: "hl" },
					assertions: [{ path: ["allowed"], equals: true }],
				},
			],
		},
	});
	console.log(
		`$ stage test Proposal through @mstack/proposals\n${proposal.id}: ${proposal.status}`,
	);
	await command(["preview", proposal.id]);
	await command(["sign", proposal.id]);
	await command(["sign", proposal.id], 1);
	assert.deepEqual(server.errors, []);
	assert.equal(server.writes(), 1);
	console.log(
		"Fake funding-server: signer recovered; every request field matched; exactly one POST.",
	);
} finally {
	server?.stop();
	await rm(home, { recursive: true, force: true });
}
