import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageOpenBody } from "@mstack/mobius-client";
import { ProposalStore } from "@mstack/proposals";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { fakeBrowserWallet } from "../../../../packages/signers/test/fake-browser-wallet.ts";
import { run } from "../../src/run.ts";
import { fakeFundingServer, loopbackFetch } from "./fake-funding-server.ts";

export async function browserFlow(
	out: (line: string) => void,
	override = false,
) {
	const home = await mkdtemp(join(tmpdir(), "mstack-w8-browser-"));
	const wallet = privateKeyToAccount(generatePrivateKey());
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
	let opens = 0;
	let driven: Promise<void> | undefined;
	const command = async (args: string[], expected = 0) => {
		out(`$ mob ${args.join(" ")}`);
		const code = await run(args, {
			stdoutIsTTY: false,
			home,
			fetch: loopbackFetch,
			out,
			err: out,
			readSecret: async () => {
				throw new Error("Browser must not ask for a secret");
			},
			openUrl: async (url) => {
				opens++;
				driven = fakeBrowserWallet(url, wallet, () =>
					access(join(home, "proposals/p-1.signature-used")),
				);
				await driven;
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
			override ? "keystore" : "browser",
		]);
		const p = await new ProposalStore(home).stage({
			kind: "sign-text",
			owner: wallet.address,
			purpose: "W8 browser fixture; no live trading",
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
						params: { ownerAddress: wallet.address, venue: "hl" },
						assertions: [{ path: ["allowed"], equals: true }],
					},
				],
			},
		});
		out(`Staged ${p.id} through @mstack/proposals`);
		await command(["preview", p.id]);
		await command(["config", "set", "policy", "locked"]);
		await command(["sign", p.id, "--with", "browser"], 1);
		assert.equal(opens, 0);
		await command(["config", "set", "policy", "manual"]);
		const sign = ["sign", p.id, ...(override ? ["--with", "browser"] : [])];
		await command(sign);
		await driven;
		await command(sign, 1);
		assert.equal(opens, 1);
		assert.equal(server.writes(), 1);
		assert.deepEqual(server.errors, []);
		out(
			"Fake browser wallet: signature accepted; marker existed before signing. Fake funding-server: signer recovered, exact body, one POST. Repeat sign refused without opening a browser.",
		);
	} finally {
		server.stop();
		await rm(home, { recursive: true, force: true });
	}
}
