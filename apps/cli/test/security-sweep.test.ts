import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createKeyStore } from "@mstack/keys";
import { ProposalStore } from "@mstack/proposals";
import { privateKeyToAccount } from "viem/accounts";
import { fakeBrowserWallet } from "../../../packages/signers/test/fake-browser-wallet.ts";
import { configHome, readConfig, setConfig } from "../src/config.ts";
import { request } from "../src/onboarding-http.ts";
import { run } from "../src/run.ts";
import { signGuard } from "../src/sign-guard.ts";

test("source output paths do not interpolate API key secrets", async () => {
	const root = join(import.meta.dir, "../../..");
	const violations: string[] = [];
	for (const pattern of ["apps/cli/src/**/*.ts", "packages/keys/src/**/*.ts"])
		for await (const relative of new Bun.Glob(pattern).scan({ cwd: root })) {
			const source = await readFile(join(root, relative), "utf8");
			for (const [index, line] of source.split("\n").entries())
				if (
					/(?:\.out|\.err|console\.(?:log|error)|\blog)\([^\n]*\$\{[^}]*(?:secret|\.key)\b/i.test(
						line,
					)
				)
					violations.push(`${relative}:${index + 1}`);
		}
	expect(violations).toEqual([]);
});

test.each([200, 500])(
	"signature echoed by HTTP %s remains only in the private audit record",
	async (status) => {
		const home = await mkdtemp(join(tmpdir(), "mstack-redaction-"));
		const wallet = privateKeyToAccount(`0x${"01".repeat(32)}`);
		const now = Math.floor(Date.now() / 1000) * 1000;
		const lines: string[] = [];
		const wallets: Promise<void>[] = [];
		let signature = "";
		const apiKey = `mobius_01234567-89ab-cdef-0123-456789abcdef.${"ab".repeat(32)}`;
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
								apiKey,
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
			expect(lines.join("\n")).not.toContain(apiKey);
			expect(lines.join("\n")).toContain("redacted");
			const proposalRecord = await readFile(
				join(home, "proposals", `${p.id}.json`),
				"utf8",
			);
			expect(proposalRecord).toContain(signature);
			expect(proposalRecord).not.toContain(apiKey);
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

test("a venue body excerpt redacts before it cuts, so a key crossing the cut leaves no run of its secret", async () => {
	const secret = "0123456789abcdef".repeat(4);
	const key = `mobius_00000000-0000-4000-8000-000000000001.${secret}`;
	for (let pad = 160; pad <= 250; pad += 3) {
		const error = await request(
			async () => new Response(`<html>${"x".repeat(pad)}${key}</html>`),
			`https://venue-${pad}.example/info`,
			"GET",
		).catch((caught) => caught);
		expect(error).toBeInstanceOf(Error);
		for (const text of [String(error), JSON.stringify(error)])
			for (let i = 0; i + 16 <= secret.length; i++)
				expect(text).not.toContain(secret.slice(i, i + 16));
	}
});

test("config bases are HTTPS, or HTTP only for loopback, whether set or edited by hand", async () => {
	const home = await mkdtemp(join(tmpdir(), "mstack-bases-"));
	try {
		for (const key of [
			"api_base",
			"strategy_api_base",
			"auth_base",
			"app_base",
		]) {
			for (const base of [
				"https://api.example",
				"http://127.0.0.1:4000",
				"http://[::1]:4000",
				"http://localhost:4000",
			])
				expect(await setConfig(key, base, home)).toBe(base);
			for (const base of [
				"http://203.0.113.9",
				"http://api.example",
				"http://127.0.0.2",
			])
				await expect(setConfig(key, base, home)).rejects.toThrow(
					"plain HTTP is allowed only for 127.0.0.1, ::1, or localhost",
				);
			await writeFile(
				join(home, "config.json"),
				JSON.stringify({ [key]: "http://203.0.113.9" }),
				{ mode: 0o600 },
			);
			await expect(readConfig(home)).rejects.toThrow(
				`${key} must be an HTTPS URL`,
			);
			await rm(join(home, "config.json"));
		}
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("the stored key goes only to the API base it was verified against", async () => {
	const home = await mkdtemp(join(tmpdir(), "mstack-key-base-"));
	const owner = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
	const key = `mobius_00000000-0000-4000-8000-000000000001.${"0123456789abcdef".repeat(4)}`;
	const sent: string[] = [];
	const lines: string[] = [];
	const rt = {
		home,
		now: () => 1_800_000_000_000,
		out: (line: string) => lines.push(line),
		err: (line: string) => lines.push(line),
		env: {},
		fetch: async (url: string | URL | Request, init?: RequestInit) => {
			if (new Headers(init?.headers).get("authorization"))
				sent.push(String(url).split("?")[0]);
			return Response.json({ tasks: [], nextCursor: null });
		},
	};
	try {
		await setConfig("owner", owner, home);
		await setConfig("key_store", "file", home);
		await setConfig("policy", "manual", home);
		await (await createKeyStore({ home, selection: "file", env: {} })).put(
			owner,
			key,
			{ importedAt: 1, verifiedAt: 1, apiBase: "https://api.mob.exchange" },
		);
		expect(
			await run(
				["config", "set", "strategy_api_base", "http://203.0.113.9"],
				rt,
			),
		).toBe(1);
		await setConfig("strategy_api_base", "http://127.0.0.1:4000", home);
		expect(await run(["status"], rt)).toBe(1);
		expect(lines.join("\n")).toContain(
			"belongs to https://api.mob.exchange, not http://127.0.0.1:4000; it was not sent",
		);
		const store = new ProposalStore(home, () => 1_800_000_000_000);
		const staged = await store.stage({
			kind: "api-submit",
			owner,
			purpose: "base fixture",
			signing: { type: "none" },
			submit: {
				base: "http://127.0.0.1:4000",
				route: "/v1/delta-neutral/tasks",
				body: {
					longVenue: "hl",
					shortVenue: "lighter",
					longMarket: "BTC",
					shortMarket: "BTC",
					sizeUsd: 100,
				},
			},
			preflightPlan: {
				checks: [{ route: "staged", name: "fixture", detail: "checked" }],
			},
		});
		await store.preview(staged.id, async () => ({
			ok: true,
			checkedAt: 1_800_000_000_000,
			checks: [
				{ route: "staged", name: "fixture", detail: "checked", ok: true },
			],
		}));
		lines.length = 0;
		expect(await run(["submit", staged.id], rt)).toBe(1);
		expect(lines.join("\n")).toContain("it was not sent");
		expect(sent).toEqual([]);
		await setConfig("strategy_api_base", "https://api.mob.exchange", home);
		expect(await run(["status"], rt)).toBe(0);
		expect(sent).toEqual(["https://api.mob.exchange/v1/delta-neutral/tasks"]);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("an empty MOB_HOME means the default home; a relative one is refused, also by the sign guard", async () => {
	expect(configHome({ MOB_HOME: "" })).toBe(join(homedir(), ".mob"));
	expect(configHome({})).toBe(join(homedir(), ".mob"));
	expect(configHome({ MOB_HOME: "/abs/home" })).toBe("/abs/home");
	expect(() => configHome({ MOB_HOME: "relative/home" })).toThrow(
		"MOB_HOME must be an absolute path",
	);
	const saved = process.env.MOB_HOME;
	process.env.MOB_HOME = "relative/home";
	try {
		const lines: string[] = [];
		expect(
			await run(["status"], {
				out: (line) => lines.push(line),
				err: (line) => lines.push(line),
			}),
		).toBe(1);
		expect(lines.join("\n")).toContain("MOB_HOME must be an absolute path");
		lines.length = 0;
		expect(
			await signGuard(
				JSON.stringify({ tool_input: { command: "mob sign p-1" } }),
				(line) => lines.push(line),
			),
		).toBe(2);
		expect(lines.join("\n")).toContain("MOB_HOME must be an absolute path");
	} finally {
		if (saved === undefined) delete process.env.MOB_HOME;
		else process.env.MOB_HOME = saved;
	}
});
