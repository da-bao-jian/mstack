import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageOpenBody } from "@mstack/mobius-client";
import { ProposalStore } from "@mstack/proposals";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { fakeWalletConnect } from "../../../../packages/signers/test/fake-walletconnect-client.ts";
import { setConfig } from "../../src/config.ts";
import { run } from "../../src/run.ts";
import { fakeFundingServer, loopbackFetch } from "./fake-funding-server.ts";

export async function walletConnectFlow(
	out: (line: string) => void,
	override = false,
) {
	const home = await mkdtemp(join(tmpdir(), "mstack-w8b-"));
	const wallet = privateKeyToAccount(generatePrivateKey());
	const fake = fakeWalletConnect(wallet);
	const request = fake.client.request;
	fake.client.request = async (params) => {
		await access(join(home, "proposals/p-1.signature-used"));
		return request(params);
	};
	const staged = stageOpenBody({
		longVenue: "hl",
		longMarket: "BTC",
		shortVenue: "lighter",
		shortMarket: "BTC",
		sizeUsd: 1000,
		longPrice: 60000,
		shortPrice: 60000.5,
		autoClose: false,
	});
	const server = fakeFundingServer(wallet.address, staged.body);
	const command = async (args: string[], expected = 0) => {
		out(`$ mob ${args.join(" ")}`);
		const code = await run(args, {
			stdoutIsTTY: false,
			home,
			out,
			err: out,
			fetch: loopbackFetch,
			walletConnectClientFactory: fake.factory,
			readSecret: async () => {
				throw new Error("WalletConnect must not ask for a secret");
			},
		});
		out(`exit=${code}`);
		assert.equal(code, expected);
	};
	try {
		await command(["config", "set", "owner", wallet.address]);
		await command([
			"config",
			"set",
			"signer",
			override ? "keystore" : "walletconnect",
		]);
		const sign = [
			"sign",
			"p-1",
			...(override ? ["--with", "walletconnect"] : []),
		];
		await command(["config", "get", "walletconnect_project_id"]);
		await command(sign, 1);
		assert.equal(fake.calls.projectIds.length, 0);
		// Protected keys need the human's terminal through the CLI.
		await setConfig("walletconnect_project_id", "c".repeat(32), home);
		const p = await new ProposalStore(home).stage({
			kind: "sign-text",
			owner: wallet.address,
			purpose: "W8b mocked WalletConnect; no relay or live trading",
			signing: { type: "text", message: staged.message },
			submit: {
				base: server.base,
				route: "/api/arbitrage/create",
				body: staged.body,
				signatureField: "signature",
			},
			preflightPlan: {
				checks: [
					{ route: "staged", name: "config.owner", detail: wallet.address },
					{
						route: "staged",
						name: "config.signer",
						detail: override ? "keystore" : "walletconnect",
					},
					{ route: "staged", name: "config.policy", detail: "manual" },
				],
			},
		});
		out(`Staged ${p.id} through @mstack/proposals`);
		await command(["preview", p.id]);
		await setConfig("policy", "locked", home);
		await command(sign, 1);
		assert.equal(fake.calls.projectIds.length, 0);
		await setConfig("policy", "manual", home);
		await command(sign);
		await command(sign, 1);
		assert.equal(fake.calls.projectIds.length, 1);
		assert.equal(fake.calls.requests.length, 1);
		assert.equal(fake.calls.closes, 1);
		assert.equal(server.writes(), 1);
		assert.deepEqual(server.errors, []);
		out(
			"Mock sign-client: one request, owner and chain matched, signature recovered, session closed. Fake funding-server: exact stored body, one POST. Repeat sign refused. No relay contacted.",
		);
	} finally {
		server.stop();
		await rm(home, { recursive: true, force: true });
	}
}
