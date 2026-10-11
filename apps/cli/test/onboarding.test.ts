import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProposalStore } from "@mstack/proposals";
import { listKeystores } from "@mstack/signers";
import { privateKeyToAccount } from "viem/accounts";
import { fakeBrowserWallet } from "../../../packages/signers/test/fake-browser-wallet.ts";
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
	const result = await bindFlow();
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
