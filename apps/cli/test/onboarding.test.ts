import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProposalStore } from "@mstack/proposals";
import { listKeystores } from "@mstack/signers";
import { privateKeyToAccount } from "viem/accounts";
import { fakeBrowserWallet } from "../../../packages/signers/test/fake-browser-wallet.ts";
import { fakeWalletConnect } from "../../../packages/signers/test/fake-walletconnect-client.ts";
import {
	getConfig,
	parsedValue,
	readConfig,
	setConfig,
} from "../src/config.ts";
import { type Runtime, run } from "../src/run.ts";
import { bindFlow } from "./fixtures/bind-flow.ts";
import { fakeOnboarding } from "./fixtures/fake-onboarding.ts";

const wallet = privateKeyToAccount(`0x${"01".repeat(32)}`);
async function harness() {
	const home = await mkdtemp(join(tmpdir(), "mstack-onboarding-test-")),
		now = Date.now();
	const server = fakeOnboarding(wallet.address, now);
	const store = new ProposalStore(home, () => now);
	const lines: string[] = [],
		walletCalls: Promise<void>[] = [];
	for (const [key, value] of [
		["owner", wallet.address],
		["signer", "browser"],
		["api_base", server.base],
		["auth_base", server.base],
	])
		await setConfig(key, value, home);
	const rt: Runtime = {
		home,
		now: () => now,
		out: (s) => lines.push(s),
		err: (s) => lines.push(s),
		fetch: server.fetch,
		prompt: async (_question, value) => value,
		openUrl: async (url) => {
			walletCalls.push(fakeBrowserWallet(url, wallet));
		},
	};
	const invoke = (args: string[]) => run(args, rt);
	const sign = async (id: string, expected = 0) => {
		server.expect(await store.get(id));
		expect(await invoke(["sign", id])).toBe(expected);
		await Promise.all(walletCalls);
	};
	return {
		home,
		now,
		server,
		store,
		lines,
		rt,
		invoke,
		sign,
		close: async () => {
			server.stop();
			await rm(home, { recursive: true, force: true });
		},
	};
}
test("setup, legal and all binding deployments recover signatures with exact bodies and re-entry", async () => {
	const lines: string[] = [];
	const result = await bindFlow((line) => lines.push(line));
	const output = lines.join("\n");
	for (const [venue, second, third] of [
		["Hyperliquid", "approve agent", "approve builder fee"],
		["Aster", "approve agent", "confirm binding"],
		["Robinhood Lighter", "approve key", "confirm binding"],
		["Lighter mainnet", "approve key", "approve integrator"],
	]) {
		expect(output).toContain(
			`${venue} binding · step 2 of 3 · ${second}\n✓ prepare binding\n▶ ${second}\n· ${third}`,
		);
		expect(output).toContain(
			`${venue} binding · step 3 of 3 · complete\n✓ prepare binding\n✓ ${second}\n✓ ${third}`,
		);
	}
	expect(result.writes).toBe(13);
	expect(result.proposals).toHaveLength(11);
	expect(
		result.proposals.every((p) => p.signatureAttemptedAt !== undefined),
	).toBe(true);
}, 120_000);
test("setup is public configuration only; accepted, absent legal service and locked policy stage nothing", async () => {
	const h = await harness();
	try {
		h.server.state.accepted = true;
		expect(await h.invoke(["setup"])).toBe(0);
		expect(await h.store.list()).toHaveLength(0);
		expect(await listKeystores(h.home)).toEqual([]);
		expect((await readConfig(h.home)).legal_chain_id).toBe(97);
		h.server.state.accepted = false;
		h.server.state.legalConfigured = false;
		expect(await h.invoke(["setup"])).toBe(0);
		expect(h.lines.join("\n")).toContain("not configured");
		h.server.state.legalConfigured = true;
		await setConfig("policy", "locked", h.home);
		expect(await h.invoke(["setup"])).toBe(0);
		expect(await h.store.list()).toHaveLength(0);
		expect(await h.invoke(["bind", "hl"])).toBe(1);
		expect(h.server.writes).toHaveLength(0);
	} finally {
		await h.close();
	}
}, 20_000);
test("stale legal acceptance records 409 and stages new terms without a second signature", async () => {
	const h = await harness();
	try {
		expect(await h.invoke(["setup"])).toBe(0);
		h.server.state.stale = true;
		await h.sign("p-1", 1);
		const old = await h.store.get("p-1"),
			fresh = await h.store.get("p-2");
		expect(old.status).toBe("failed");
		expect(old.answer).toEqual({ error: "stale_version" });
		expect(fresh.submit.body.termsVersion).toBe("2026-11");
		expect(fresh.signatureAttemptedAt).toBeUndefined();
		expect(fresh.digest).not.toBe(old.digest);
		await h.sign("p-2");
		expect(h.server.state.accepted).toBe(true);
		expect(await h.invoke(["setup"])).toBe(0);
		expect(await h.store.list()).toHaveLength(2);
		expect(h.server.errors).toEqual([]);
	} finally {
		await h.close();
	}
}, 20_000);
test.each(["hl", "aster", "lighter", "lighter-mainnet"])(
	"%s fresh prepare requires rebind allowed",
	async (venue) => {
		const h = await harness();
		try {
			h.server.state.rebind = false;
			expect(await h.invoke(["bind", venue])).toBe(1);
			expect(h.lines.join("\n")).toContain("active tasks");
			expect(await h.store.list()).toHaveLength(0);
			expect(h.server.writes).toHaveLength(0);
		} finally {
			await h.close();
		}
	},
	10_000,
);
test("HL requires a funded owner; Lighter requires an existing account", async () => {
	const h = await harness();
	try {
		h.server.state.funded = false;
		expect(await h.invoke(["bind", "hl"])).toBe(1);
		expect(h.lines.join("\n")).toContain("never deposited");
		h.server.state.account = false;
		for (const venue of ["lighter", "lighter-mainnet"])
			expect(await h.invoke(["bind", venue])).toBe(1);
		expect(h.lines.join("\n")).toContain("Create a Lighter account first");
		expect(await h.store.list()).toHaveLength(0);
	} finally {
		await h.close();
	}
}, 15_000);
test("HL browser chain is obtained in a connection-only step before immutable staging", async () => {
	const h = await harness();
	try {
		expect(await h.invoke(["bind", "hl"])).toBe(0);
		await h.sign("p-1");
		expect(await h.invoke(["bind", "hl"])).toBe(0);
		const p = await h.store.get("p-2");
		expect(p.signatureAttemptedAt).toBeUndefined();
		expect(p.signing.type).toBe("typed");
		if (p.signing.type === "typed")
			expect(p.signing.typedData.domain?.chainId).toBe(1);
		expect(p.submit.body.action).toMatchObject({ signatureChainId: "0x1" });
		expect(h.server.writes).toHaveLength(1);
		expect(await h.invoke(["bind", "hl"])).toBe(0);
		expect(await h.store.list()).toHaveLength(2);
	} finally {
		await h.close();
	}
}, 20_000);
test("Lighter integrator refusal is recorded and is not signed again on re-entry", async () => {
	const h = await harness();
	try {
		for (const id of ["p-1", "p-2"]) {
			expect(await h.invoke(["bind", "lighter-mainnet"])).toBe(0);
			await h.sign(id);
		}
		h.server.state.integratorRefused = true;
		expect(await h.invoke(["bind", "lighter-mainnet"])).toBe(0);
		await h.sign("p-3", 1);
		expect((await h.store.get("p-3")).answer).toEqual({
			error: "venue tier does not permit integrator approval",
		});
		expect(await h.invoke(["bind", "lighter-mainnet"])).toBe(0);
		expect(await h.store.list()).toHaveLength(3);
		expect(h.lines.join("\n")).toContain("No automatic repeat");
		expect(h.server.errors).toEqual([]);
	} finally {
		await h.close();
	}
}, 25_000);
test("onboarding config defaults and invalid chains, owners, secret flags fail", async () => {
	expect(getConfig({}, "auth_base")).toBe("https://auth.mob.exchange");
	expect(getConfig({}, "legal_chain_id")).toBe(97);
	expect(getConfig({}, "hl_signature_chain_id")).toBe("0xa4b1");
	for (const [key, value] of [
		["legal_chain_id", "0"],
		["legal_chain_id", "1.2"],
		["hl_signature_chain_id", "0x0"],
		["hl_signature_chain_id", "42161"],
	])
		expect(() => parsedValue(key, value)).toThrow();
	const h = await harness();
	try {
		h.rt.prompt = async () => "invalid";
		expect(await h.invoke(["setup"])).toBe(1);
		expect(await h.invoke(["setup", "--yes"])).toBe(1);
		expect(await h.invoke(["bind", "hl", "--private-key", "secret"])).toBe(1);
		expect(await h.invoke(["bind", "binance"])).toBe(1);
		expect(await h.store.list()).toHaveLength(0);
	} finally {
		await h.close();
	}
});

test("completion failure and expiry retain the venue receipt and never finalize", async () => {
	const { submitPlan } = await import("../src/onboarding-http.ts");
	const { hlTypedAction, ApiError } = await import("@mstack/mobius-client");
	const h = await harness();
	try {
		const action = {
			type: "approveBuilderFee",
			signatureChainId: "0xa4b1",
			hyperliquidChain: "Mainnet",
			maxFeeRate: "0.1%",
			builder: wallet.address,
			nonce: h.now,
		};
		const p = await h.store.stage({
			owner: wallet.address,
			kind: "sign-typed",
			purpose: "hl test approval",
			signing: { type: "typed", typedData: hlTypedAction(action) },
			submit: {
				base: "https://api.hyperliquid.xyz",
				route: "/exchange",
				format: "hl",
				signatureField: "signature",
				body: { action, nonce: action.nonce },
				completion: {
					base: h.server.base,
					statusRoute: "/api/binding/hl/status",
					sessionId: "test",
					finalize: {
						route: "/api/binding/hl/builder-finalize",
						body: { ownerAddress: wallet.address },
					},
				},
			},
			preflightPlan: {
				checks: [{ route: "staged", name: "fixture", detail: "local test" }],
			},
		});
		const signature = await wallet.signTypedData(hlTypedAction(action));
		for (const expired of [false, true]) {
			let clock = h.now;
			const calls: string[] = [];
			try {
				await submitPlan(
					p,
					{ ...p.submit.body, signature },
					{
						...h.rt,
						now: () => clock,
						fetch: async (url) => {
							calls.push(url);
							if (url.endsWith("/exchange"))
								return Response.json({
									status: "ok",
									response: { type: "default" },
								});
							if (url.includes("/status?")) {
								if (expired) clock = p.expiresAt;
								return Response.json(
									expired
										? { status: "bound" }
										: { status: "failed", error: "fixture refusal" },
								);
							}
							throw new Error("Unexpected finalization after terminal event");
						},
					},
				);
				throw new Error("Expected terminal completion failure");
			} catch (error) {
				expect(error).toBeInstanceOf(ApiError);
				expect((error as InstanceType<typeof ApiError>).data).toMatchObject({
					venue: { status: "ok" },
					binding: { status: expired ? "bound" : "failed" },
				});
				expect(String(error)).toContain(
					expired ? "expired before builder finalization" : "fixture refusal",
				);
			}
			expect(calls).toHaveLength(2);
		}
		for (const answer of [
			null,
			[],
			{ status: "err", response: "venue refusal" },
		]) {
			try {
				await submitPlan(
					p,
					{ ...p.submit.body, signature },
					{ ...h.rt, fetch: async () => Response.json(answer) },
				);
				throw new Error("Expected venue refusal");
			} catch (error) {
				expect(error).toBeInstanceOf(ApiError);
				expect((error as InstanceType<typeof ApiError>).data).toEqual(answer);
			}
		}
	} finally {
		await h.close();
	}
}, 15_000);

test("a status transition to bound selects the remaining integrator step in the same invocation", async () => {
	const h = await harness();
	try {
		h.rt.fetch = async (url, init) => {
			if (url.includes("/credential?")) {
				if (!h.lines.includes("credential-refreshed")) {
					h.lines.push("credential-refreshed");
					return Response.json({
						bound: false,
						session: { sessionId: "already-approved", status: "pending" },
					});
				}
				return Response.json({
					bound: true,
					publicKey: "existing-key",
					slot: 3,
					accountIndex: 22,
					chainId: 304,
					integratorApproved: false,
					integratorIndex: 7,
				});
			}
			if (url.includes("/status?")) return Response.json({ status: "bound" });
			return h.server.fetch(url, init);
		};
		expect(await h.invoke(["bind", "lighter-mainnet"])).toBe(0);
		expect(await h.store.list()).toHaveLength(1);
		expect((await h.store.get("p-1")).submit.binding?.step).toBe(
			"approve-integrator",
		);
		expect(h.server.writes).toHaveLength(0);
	} finally {
		await h.close();
	}
}, 10_000);
test("existing builder-only repair does not silently replace the venue key", async () => {
	const h = await harness();
	try {
		h.rt.fetch = async () =>
			Response.json({
				bound: false,
				repair: {
					agentAddress: wallet.address,
					builderAddress: wallet.address,
					needsBuilderFee: true,
				},
			});
		expect(await h.invoke(["bind", "hl"])).toBe(1);
		expect(h.lines.join("\n")).toContain("standalone builder repair");
		expect(await h.store.list()).toHaveLength(0);
	} finally {
		await h.close();
	}
});

test("HL WalletConnect binding pins the configured signing chain without opening a browser", async () => {
	const h = await harness();
	try {
		await setConfig("signer", "walletconnect", h.home);
		await setConfig("walletconnect_project_id", "c".repeat(32), h.home);
		h.rt.openUrl = async () => {
			throw new Error("Unexpected browser fallback");
		};
		h.rt.walletConnectClientFactory = fakeWalletConnect(wallet).factory;
		expect(await h.invoke(["bind", "hl"])).toBe(0);
		await h.sign("p-1");
		expect(await h.invoke(["bind", "hl"])).toBe(0);
		const proposal = await h.store.get("p-2");
		if (proposal.signing.type !== "typed")
			throw new Error("Expected HL typed data");
		expect(proposal.signing.typedData.domain?.chainId).toBe(42161);
		const fake = fakeWalletConnect(wallet, 42161);
		h.rt.walletConnectClientFactory = fake.factory;
		await h.sign("p-2");
		expect(fake.calls.requests[0].chainId).toBe("eip155:42161");
		expect(h.server.errors).toEqual([]);
		expect((await h.store.list()).map((p) => p.status)).toEqual([
			"submitted",
			"submitted",
		]);
	} finally {
		await h.close();
	}
}, 20_000);

test.each(["keystore", "browser", "walletconnect"])(
	"setup flags configure %s without prompts or legal requests when skipped",
	async (signer) => {
		const h = await harness();
		try {
			h.rt.stdinIsTTY = false;
			h.rt.prompt = async () => {
				throw new Error("Unexpected prompt");
			};
			h.rt.fetch = async () => {
				throw new Error("Unexpected legal request");
			};
			expect(
				await h.invoke([
					"setup",
					"--owner",
					wallet.address,
					"--signer",
					signer,
					"--policy",
					"locked",
					"--auth-base",
					"https://auth.mob.exchange",
					"--legal-chain-id",
					"56",
					"--no-legal",
					...(signer === "walletconnect"
						? ["--walletconnect-project-id", "b".repeat(32)]
						: []),
				]),
			).toBe(0);
			const config = await readConfig(h.home);
			expect(config).toMatchObject({
				owner: wallet.address,
				signer,
				policy: "locked",
				auth_base: "https://auth.mob.exchange",
				legal_chain_id: 56,
			});
			if (signer === "walletconnect")
				expect(config.walletconnect_project_id).toBe("b".repeat(32));
			expect(h.lines.join("\n")).toContain(
				"Legal acceptance skipped (--no-legal).",
			);
			expect(await listKeystores(h.home)).toEqual([]);
			expect(await h.store.list()).toEqual([]);
		} finally {
			await h.close();
		}
	},
);
test("non-interactive setup lists missing flags even with saved config and never prompts", async () => {
	const h = await harness();
	try {
		h.rt.stdinIsTTY = false;
		h.rt.prompt = async () => {
			throw new Error("Unexpected prompt");
		};
		const before = await readConfig(h.home);
		expect(await h.invoke(["setup"])).toBe(1);
		expect(h.lines.at(-1)).toContain("--owner, --signer, --policy");
		expect(
			await h.invoke([
				"setup",
				"--owner",
				wallet.address,
				"--signer",
				"walletconnect",
			]),
		).toBe(1);
		expect(h.lines.at(-1)).toContain("--policy, --walletconnect-project-id");
		expect(await readConfig(h.home)).toEqual(before);
	} finally {
		await h.close();
	}
});
test("complete flags avoid prompts on a TTY and use defaults; saved WalletConnect ID can be reused", async () => {
	const h = await harness();
	try {
		h.rt.stdinIsTTY = true;
		h.rt.prompt = async () => {
			throw new Error("Unexpected prompt");
		};
		await setConfig("walletconnect_project_id", "a".repeat(32), h.home);
		expect(
			await h.invoke([
				"setup",
				"--owner",
				wallet.address,
				"--signer",
				"walletconnect",
				"--policy",
				"manual",
				"--no-legal",
			]),
		).toBe(0);
		expect((await readConfig(h.home)).legal_chain_id).toBe(97);
		expect((await readConfig(h.home)).walletconnect_project_id).toBe(
			"a".repeat(32),
		);
	} finally {
		await h.close();
	}
});
test("interactive setup numbers the five prompts and preserves defaults, including WalletConnect detail", async () => {
	const h = await harness();
	try {
		const questions: string[] = [];
		h.rt.prompt = async (question, fallback) => {
			questions.push(`${question} [${fallback}]`);
			return fallback;
		};
		expect(await h.invoke(["setup", "--no-legal"])).toBe(0);
		expect(questions).toEqual([
			`Setup · 1 of 5 · Owner [${wallet.address}]`,
			"Setup · 2 of 5 · Signer (keystore | browser | walletconnect) [browser]",
			"Setup · 3 of 5 · Policy (manual | locked) [manual]",
			`Setup · 4 of 5 · Auth API base [${h.server.base}]`,
			"Setup · 5 of 5 · Legal signing chain id [97]",
		]);
		questions.length = 0;
		h.rt.prompt = async (question, fallback) => {
			questions.push(question);
			return question.includes("Signer (")
				? "walletconnect"
				: question.includes("project ID")
					? "f".repeat(32)
					: fallback;
		};
		expect(
			await h.invoke(["setup", "--owner", wallet.address, "--no-legal"]),
		).toBe(0);
		expect(questions).not.toContain("Setup · 1 of 5 · Owner");
		expect(questions).toContain("Setup · 2 of 5 · WalletConnect project ID");
	} finally {
		await h.close();
	}
});
test.each([
	["--owner", "bad"],
	["--signer", "auto"],
	["--policy", "auto"],
	["--auth-base", "https://name:password@auth.mob.exchange"],
	["--legal-chain-id", "0"],
	["--walletconnect-project-id", "not-an-id"],
])("invalid setup %s fails before any config is saved", async (flag, value) => {
	const h = await harness();
	try {
		const before = await readConfig(h.home);
		const values = new Map([
			["--owner", wallet.address],
			["--signer", "browser"],
			["--policy", "manual"],
			[flag, value],
		]);
		expect(
			await h.invoke(["setup", ...Array.from(values).flat(), "--no-legal"]),
		).toBe(1);
		expect(await readConfig(h.home)).toEqual(before);
		expect(h.server.writes).toHaveLength(0);
	} finally {
		await h.close();
	}
});
test("non-interactive setup still stages legal acceptance and stops before signing", async () => {
	const h = await harness();
	try {
		h.rt.stdinIsTTY = false;
		h.rt.prompt = async () => {
			throw new Error("Unexpected prompt");
		};
		expect(
			await h.invoke([
				"setup",
				"--owner",
				wallet.address,
				"--signer",
				"browser",
				"--policy",
				"manual",
			]),
		).toBe(0);
		expect((await h.store.list()).map((p) => p.status)).toEqual([
			"awaiting-signature",
		]);
		expect(h.lines.join("\n")).toContain("Stopped before signing.");
		expect(h.server.writes).toHaveLength(0);
	} finally {
		await h.close();
	}
});
test("binding indicators show the next action before preview, including pending re-entry", async () => {
	const h = await harness();
	try {
		for (let i = 0; i < 2; i++) {
			h.lines.length = 0;
			expect(await h.invoke(["bind", "hl"])).toBe(0);
			const output = h.lines.join("\n");
			expect(output).toStartWith(
				"Hyperliquid binding · step 1 of 3 · prepare binding\n▶ prepare binding\n· approve agent\n· approve builder fee",
			);
			expect(output.indexOf("This signature asks Mobius")).toBeLessThan(
				output.indexOf("p-1 ·"),
			);
			expect(output).toContain("After submission, run mob bind hl");
			expect(output).toContain("Stopped before signing.");
		}
		await h.sign("p-1");
		h.lines.length = 0;
		expect(await h.invoke(["bind", "hl"])).toBe(0);
		expect(h.lines.join("\n")).toContain(
			"Hyperliquid binding · step 2 of 3 · approve agent\n✓ prepare binding\n▶ approve agent\n· approve builder fee",
		);
	} finally {
		await h.close();
	}
}, 15_000);

test("setup exits with open piped stdin instead of waiting for answers", async () => {
	const home = await mkdtemp(join(tmpdir(), "mstack-w15-stdin-"));
	const child = Bun.spawn(
		[
			process.execPath,
			"run",
			new URL("../src/main.ts", import.meta.url).pathname,
			"setup",
		],
		{
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, MOB_HOME: home },
		},
	);
	const timeout = setTimeout(() => child.kill(), 5_000);
	try {
		expect(await child.exited).toBe(1);
		expect(await new Response(child.stderr).text()).toContain(
			"--owner, --signer, --policy",
		);
	} finally {
		clearTimeout(timeout);
		child.stdin.end();
		await rm(home, { recursive: true, force: true });
	}
}, 10_000);
