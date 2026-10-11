import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProposalStore } from "@mstack/proposals";
import { privateKeyToAccount } from "viem/accounts";
import { fakeBrowserWallet } from "../../../packages/signers/test/fake-browser-wallet.ts";
import { setConfig } from "../src/config.ts";
import { run } from "../src/run.ts";

test.each([200, 500])(
	"signature echoed by HTTP %s remains only in the private audit record",
	async (status) => {
		const home = await mkdtemp(join(tmpdir(), "mstack-redaction-"));
		const wallet = privateKeyToAccount(`0x${"01".repeat(32)}`);
		const now = Math.floor(Date.now() / 1000) * 1000;
		const lines: string[] = [];
		const wallets: Promise<void>[] = [];
		let signature = "";
		try {
			await setConfig("owner", wallet.address, home);
			await setConfig("signer", "browser", home);
			const store = new ProposalStore(home, () => now);
			const p = await store.stage({
				kind: "sign-text",
				owner: wallet.address,
				purpose: "Echo test",
				signing: {
					type: "text",
					message: `Close arbitrage task: test timestamp=${now / 1000}`,
				},
				submit: {
					base: "https://fake.invalid",
					route: "/api/arbitrage/close",
					body: { taskId: "test", timestamp: now / 1000 },
					signatureField: "signature",
				},
				preflightPlan: {
					checks: [
						{ route: "staged", name: "fixture", detail: "Only test data" },
					],
				},
			});
			await store.preview(p.id, async () => ({
				ok: true,
				checkedAt: now,
				checks: [{ route: "staged", name: "fixture", ok: true }],
			}));
			const invoke = (args: string[]) =>
				run(args, {
					home,
					now: () => now,
					out: (s) => lines.push(s),
					err: (s) => lines.push(s),
					openUrl: async (url) => {
						wallets.push(fakeBrowserWallet(url, wallet));
					},
					fetch: async (_url, init) => {
						signature = JSON.parse(String(init?.body)).signature;
						return Response.json(
							{
								ok: true,
								signature,
								echo: signature,
								split: {
									r: signature.slice(0, 66),
									s: `0x${signature.slice(66, 130)}`,
									v: 27,
								},
								nested: { signature: { result: { bytes: signature } } },
							},
							{ status },
						);
					},
				});
			expect(await invoke(["sign", p.id])).toBe(status === 200 ? 0 : 1);
			await Promise.all(wallets);
			expect(signature).toMatch(/^0x[\da-f]{130}$/i);
			for (const args of [
				["proposal", "show", p.id],
				["proposal", "show", p.id, "--json"],
				["proposals", "--json"],
			])
				expect(await invoke(args)).toBe(0);
			expect(lines.join("\n")).not.toContain(signature);
			expect(lines.join("\n")).not.toContain(signature.slice(0, 66));
			expect(lines.join("\n")).toContain("redacted");
			expect(
				await readFile(join(home, "proposals", `${p.id}.json`), "utf8"),
			).toContain(signature);
			for (const name of ["counter", "p-1.intent", "p-1.signature-used"])
				expect(
					await readFile(join(home, "proposals", name), "utf8"),
				).not.toContain(signature);
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	},
);

test("doctor hides non-public config and unexpected server bodies, including malformed config", async () => {
	const home = await mkdtemp(join(tmpdir(), "mstack-doctor-secrets-"));
	const lines: string[] = [];
	const sentinel = "secret-output-canary-w17";
	try {
		await setConfig(
			"owner",
			"0x0000000000000000000000000000000000000001",
			home,
		);
		await setConfig("signer", "walletconnect", home);
		await setConfig("walletconnect_project_id", "ab".repeat(16), home);
		const invoke = () =>
			run(["doctor", "--json"], {
				home,
				out: (s) => lines.push(s),
				err: (s) => lines.push(s),
				fetch: async () =>
					Response.json(
						{ error: sentinel, privateKey: sentinel },
						{ status: 500 },
					),
				homeServices: {
					networkBudgetMs: 30,
					upgrade: async () => ({ state: "not checked" }),
				},
			});
		expect(await invoke()).toBe(1);
		expect(lines.join("\n")).not.toContain(sentinel);
		expect(lines.join("\n")).not.toContain("ab".repeat(16));
		await writeFile(join(home, "config.json"), `{"owner": "${sentinel}`);
		lines.length = 0;
		expect(await invoke()).toBe(1);
		expect(lines.join("\n")).toContain("malformed JSON");
		expect(lines.join("\n")).not.toContain(sentinel);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
