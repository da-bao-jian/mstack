import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProposalStore } from "@mstack/proposals";
import { listKeystores } from "@mstack/signers";
import { metadataContext } from "../../../../packages/funding/test/metadata-fixtures.ts";
import { setConfig } from "../../src/config.ts";
import { run } from "../../src/run.ts";
import { fakePositionServer, loopbackFetch } from "./fake-funding-server.ts";

export async function openFlow(
	log: (line: string) => void = () => {},
	extraManage = false,
) {
	const home = await mkdtemp(join(tmpdir(), "mstack-w10-smoke-"));
	const password = crypto.randomUUID();
	const now = Date.now();
	const ctx = await metadataContext();
	let server: ReturnType<typeof fakePositionServer> | undefined;
	let prompts = 0;
	const command = async (args: string[], expected = 0) => {
		log(`$ mob ${args.join(" ")}`);
		const code = await run(args, {
			home,
			now: () => now,
			fetch: async (url, init) =>
				url.startsWith("http://127.0.0.1:")
					? loopbackFetch(url, init)
					: ctx.fetch(url, init),
			out: log,
			err: log,
			readSecret: async () => {
				prompts++;
				log("[hidden; injected test TTY reader]");
				return password;
			},
		});
		log(`exit=${code}`);
		assert.equal(code, expected);
	};
	try {
		await command(["keystore", "create"]);
		const [owner] = await listKeystores(home);
		server = fakePositionServer(owner, () => now);
		await command(["config", "set", "owner", owner]);
		await command(["config", "set", "signer", "keystore"]);
		// api_base needs the human's terminal through the CLI; write it directly.
		await setConfig("api_base", server.base, home);
		await command([
			"open",
			"BTC",
			"--long",
			"hl:BTC",
			"--short",
			"lighter:BTC",
			"--size",
			"1000",
			"--protect",
			"8",
			"--assume-leverage",
			"3",
			"--auto-close",
			"off",
		]);
		assert.equal(prompts, 2, "staging must not unlock a key");
		assert.equal(server.writes.length, 0);
		const store = new ProposalStore(home, () => now);
		const open = await store.get("p-1");
		const expected = {
			longVenue: "hl",
			longMarket: "BTC",
			shortVenue: "lighter",
			shortMarket: "BTC",
			sizeUsd: 1000,
			longPrice: 82794,
			shortPrice: 82773.5,
			minFundingApy: 0,
			nonce: open.submit.body.nonce,
			timestamp: Math.floor(now / 1000),
			autoClose: false,
			maxSpreadBps: 50,
			liqProtectionPct: 8,
		};
		assert.match(String(expected.nonce), /^[0-9a-f-]{36}$/);
		assert.deepEqual(open.submit.body, expected);
		await command(["preview", "p-1"]);
		assert.equal((await store.get("p-1")).signing.type, "text");
		assert.deepEqual((await store.get("p-1")).submit.body, expected);
		server.expect("/api/arbitrage/create", expected);
		await command(["sign", "p-1"]);
		await command(["status", "--task", "fake-w10-1"]);
		let next = 2;
		const manage = async (
			args: string[],
			route: string,
			fields: Record<string, unknown>,
		) => {
			await command(args);
			const id = `p-${next++}`;
			const p = await store.get(id);
			const body = {
				taskId: "fake-w10-1",
				timestamp: Math.floor(now / 1000),
				...fields,
			};
			assert.deepEqual(p.submit.body, body);
			assert.ok(
				p.purpose.includes("replayable inside the server's 300 s window"),
			);
			server?.expect(route, body);
			await command(["sign", id]);
		};
		await manage(
			["protect", "fake-w10-1", "6"],
			"/api/arbitrage/liq-protection",
			{ liqProtectionPct: 6 },
		);
		if (extraManage) {
			await manage(
				["protect", "fake-w10-1", "off"],
				"/api/arbitrage/liq-protection",
				{ liqProtectionPct: null },
			);
			await manage(
				["neutralize", "fake-w10-1"],
				"/api/arbitrage/neutralize",
				{},
			);
			await manage(
				["resize", "fake-w10-1", "--long", "0.02", "--short", "0.02"],
				"/api/arbitrage/resize",
				{ longTargetBase: 0.02, shortTargetBase: 0.02 },
			);
			await manage(
				["auto-close", "fake-w10-1", "on", "--min-apy", "12"],
				"/api/arbitrage/auto-close",
				{ autoClose: true, minFundingApy: 12 },
			);
			await manage(
				["size-mismatch-close", "fake-w10-1", "on", "--pct", "5"],
				"/api/arbitrage/size-mismatch-auto-close",
				{ enabled: true, thresholdPct: 5 },
			);
			await manage(
				["size-mismatch-close", "fake-w10-1", "off", "--pct", "5"],
				"/api/arbitrage/size-mismatch-auto-close",
				{ enabled: false, thresholdPct: 0 },
			);
		}
		await manage(["close", "fake-w10-1"], "/api/arbitrage/close", {});
		await command(["sign", `p-${next - 1}`], 1);
		assert.deepEqual(server.errors, []);
		assert.equal(server.writes.length, next - 1);
		log(
			`Fake funding-server: ${server.writes.length} POSTs; each signer recovered with hashMessage + recoverAddress; every body field matched. Repeat signing refused.`,
		);
		log(
			"Task execution is simulated by the fixture; no live venue or Mobius write occurred.",
		);
		return {
			writes: server.writes.length,
			proposals: await store.list(),
			prompts,
		};
	} finally {
		server?.stop();
		await rm(home, { recursive: true, force: true });
	}
}
