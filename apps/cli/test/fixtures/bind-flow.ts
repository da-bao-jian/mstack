import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProposalStore } from "@mstack/proposals";
import { listKeystores } from "@mstack/signers";
import { setConfig } from "../../src/config.ts";
import { run } from "../../src/run.ts";
import { fakeOnboarding } from "./fake-onboarding.ts";
export async function bindFlow(log: (line: string) => void = () => {}) {
	const home = await mkdtemp(join(tmpdir(), "mstack-w9-smoke-"));
	const now = Date.now(),
		password = crypto.randomUUID();
	let server: ReturnType<typeof fakeOnboarding> | undefined;
	let answers: string[] = [],
		prompts = 0;
	const command = async (args: string[], expected = 0) => {
		log(`$ mob ${args.join(" ")}`);
		const code = await run(args, {
			home,
			now: () => now,
			out: log,
			err: log,
			fetch: (url, init) => {
				assert.ok(server);
				return server.fetch(url, init);
			},
			readSecret: async () => {
				prompts++;
				log("[hidden; injected test TTY reader]");
				return password;
			},
			prompt: async (question, fallback) => {
				const answer = answers.shift() ?? fallback;
				log(`${question}: ${answer}`);
				return answer;
			},
		});
		log(`exit=${code}`);
		assert.equal(code, expected);
	};
	try {
		await command(["keystore", "create"]);
		const [owner] = await listKeystores(home);
		server = fakeOnboarding(owner, now);
		await setConfig("api_base", server.base, home);
		answers = [owner, "keystore", "manual", server.base, "56"];
		const store = new ProposalStore(home, () => now);
		const stage = async (args: string[], step: string) => {
			const count = (await store.list()).length,
				beforePrompts = prompts,
				beforeWrites = server?.writes.length;
			await command(args);
			const proposals = await store.list();
			assert.equal(proposals.length, count + 1);
			const proposal = await store.get(`p-${count + 1}`);
			assert.ok(proposal.purpose.includes(step));
			assert.equal(prompts, beforePrompts);
			assert.equal(server?.writes.length, beforeWrites);
			// Re-entry before approval must show the same pending intent, not another signature request.
			await command(args);
			assert.equal((await store.list()).length, count + 1);
			await command(["preview", proposal.id]);
			server?.expect(proposal);
			await command(["sign", proposal.id]);
			assert.equal((await store.get(proposal.id)).status, "submitted");
		};
		await stage(["setup"], "Accept MoB legal terms");
		for (const [venue, steps] of [
			["hl", ["prepare", "approve-agent", "approve-builder-fee"]],
			["aster", ["prepare", "approve-agent"]],
			["lighter", ["prepare", "approve-key", "approve-integrator"]],
			["lighter-mainnet", ["prepare", "approve-key", "approve-integrator"]],
		] as const) {
			for (const step of steps) await stage(["bind", venue], step);
			const count = (await store.list()).length;
			await command(["bind", venue]);
			assert.equal((await store.list()).length, count);
		}
		await command(["sign", "p-12"], 1);
		assert.deepEqual(server.errors, []);
		assert.equal(server.writes.length, 14);
		for (const write of server.writes) log(`Fake server: ${write}`);
		log(
			"12 Proposals; 14 sanctioned POSTs including two stored builder-finalize calls. Every signer recovered, every mutation field checked. Re-entry stages only the next step; repeat sign refused.",
		);
		log(
			"All endpoints are local fakes. No live binding, legal acceptance or venue mutation occurred.",
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
