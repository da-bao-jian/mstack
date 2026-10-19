import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageOpenBody } from "@mstack/mobius-client";
import { ProposalStore } from "@mstack/proposals";
import { listKeystores } from "@mstack/signers";
import { setConfig } from "../src/config.ts";
import { run } from "../src/run.ts";
import {
	fakeFundingServer,
	loopbackFetch,
} from "./fixtures/fake-funding-server.ts";

test.each([false, true])(
	"CLI create, stage, preview, sign against actual fake HTTP server (readiness failure: %s)",
	async (readinessFailure) => {
		const home = await mkdtemp(join(tmpdir(), "mstack-p1-cli-test-"));
		const password = crypto.randomUUID();
		const lines: string[] = [];
		const errors: string[] = [];
		let prompts = 0;
		const invoke = (args: string[]) =>
			run(args, {
				home,
				out: (s) => lines.push(s),
				err: (s) => errors.push(s),
				fetch: loopbackFetch,
				readSecret: async () => {
					prompts++;
					return password;
				},
			});
		let server: ReturnType<typeof fakeFundingServer> | undefined;
		try {
			expect(await invoke(["keystore", "create"])).toBe(0);
			const [owner] = await listKeystores(home);
			expect(owner).toBeDefined();
			expect(await invoke(["config", "set", "owner", owner])).toBe(0);
			expect(await invoke(["config", "set", "signer", "keystore"])).toBe(0);
			const staged = stageOpenBody({
				longVenue: "hl",
				longMarket: "xyz:NVDA",
				shortVenue: "aster",
				shortMarket: "USD1:NVDA",
				sizeUsd: 1000,
				longPrice: 123.25,
				shortPrice: 123.5,
				autoClose: false,
				maxSpreadBps: 50,
			});
			server = fakeFundingServer(owner, staged.body, { readinessFailure });
			const store = new ProposalStore(home);
			const p = await store.stage({
				kind: "sign-text",
				owner,
				purpose: "Fake-server open only",
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
			expect(await invoke(["proposals"])).toBe(0);
			expect(await invoke(["proposal", "show", p.id])).toBe(0);
			expect(await invoke(["preview", p.id])).toBe(0);
			expect(prompts).toBe(2);
			expect(server.writes()).toBe(0);
			// Config may change after staging; the persisted submit plan remains authoritative.
			await setConfig("api_base", "https://ignored.invalid", home);
			expect(await invoke(["sign", p.id, "--with", "keystore"])).toBe(
				readinessFailure ? 1 : 0,
			);
			expect(prompts).toBe(3);
			expect(server.writes()).toBe(1);
			expect(server.errors).toEqual([]);
			const saved = await store.get(p.id);
			expect(saved.status).toBe(readinessFailure ? "failed" : "submitted");
			if (readinessFailure) {
				expect(saved.answer).toHaveProperty("readiness");
				expect(errors.join("\n")).toContain('"issue":"not_bound"');
			} else expect(saved.answer).toEqual({ taskId: "fake-w7-1" });
			expect(await invoke(["sign", p.id])).toBe(1);
			expect(server.writes()).toBe(1);
			expect(prompts).toBe(3);
			expect(lines.join("\n")).toContain(staged.message);
			expect(lines.join("\n")).toContain(p.digest);
			expect(lines.join("\n") + errors.join("\n")).not.toContain(password);
		} finally {
			server?.stop();
			await rm(home, { recursive: true, force: true });
		}
	},
);
test("CLI rejects secret flags and automatic approval before requesting any input", async () => {
	let prompts = 0;
	for (const args of [
		["keystore", "create", "--private-key", "x"],
		["keystore", "import", "0x123"],
		["sign", "p-1", "--yes"],
		["sign", "p-1", "--passphrase", "x"],
	]) {
		expect(
			await run(args, {
				out: () => {},
				err: () => {},
				readSecret: async () => {
					prompts++;
					throw new Error("must not read");
				},
			}),
		).toBe(1);
	}
	expect(prompts).toBe(0);
});
