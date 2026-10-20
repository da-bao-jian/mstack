import assert from "node:assert/strict";
import type { Fetch } from "@mstack/mobius-client";
import type { Proposal } from "@mstack/proposals";
import {
	type Address,
	getAddress,
	type Hex,
	hashMessage,
	hashTypedData,
	recoverAddress,
	type TypedDataDefinition,
} from "viem";
import { loopbackFetch } from "./fake-funding-server.ts";

type Venue = "hl" | "aster" | "lighter" | "lighter-mainnet";
const agent = "0x0000000000000000000000000000000000000002";
const builder = "0x0000000000000000000000000000000000000003";
const statement =
	"I have read and agree to the Mobius Terms of Service and Privacy Policy. This signature only records my acceptance. It does not authorize any transaction and cannot move funds.";
const fields = (pairs: string[][]) =>
	pairs.map(([name, type]) => ({ name, type }));
export function fakeOnboarding(owner: Address, now = Date.now()) {
	const state = {
		accepted: false,
		legalConfigured: true,
		stale: false,
		rebind: true,
		funded: true,
		account: true,
		integratorRefused: false,
		legalChain: 56,
	};
	const terms = {
		termsVersion: "2026-10",
		termsUrl: "https://mob.exchange/terms",
		privacyVersion: "2026-10",
		privacyUrl: "https://mob.exchange/privacy",
	};
	const sessions = new Map<
		Venue,
		{
			id: string;
			agentApproved: boolean;
			builderApproved: boolean;
			integratorApproved: boolean;
		}
	>();
	const errors: string[] = [],
		writes: string[] = [];
	let expected: Proposal | undefined;
	const params = {
		agentName: "mobius-bot",
		agentAddress: agent,
		ipWhitelist: "",
		expired: now + 365 * 86400_000,
		canSpotTrade: false,
		canPerpTrade: true,
		canWithdraw: false,
		builder,
		maxFeeRate: "0.1%",
		builderName: "mobius",
		asterChain: "Mainnet",
		user: owner.toLowerCase(),
		nonce: now * 1000,
	};
	const txInfo = (venue: Venue) => ({
		AccountIndex: venue === "lighter" ? 11 : 22,
		ApiKeyIndex: 3,
		PublicKey: `public-${venue}`,
		Nonce: 1,
	});
	const message = (venue: Venue) =>
		`ChangePubKey account=${venue === "lighter" ? 11 : 22}\nkey=public-${venue}`;
	const prepared = (venue: Venue) => {
		const s = sessions.get(venue);
		assert.ok(s);
		return venue === "hl"
			? { sessionId: s.id, agentAddress: agent, builderAddress: builder }
			: venue === "aster"
				? {
						sessionId: s.id,
						agentAddress: agent,
						approvalParams: params,
						baseUrl: "https://fapi.asterdex.com",
						signingChainId: 56,
					}
				: {
						sessionId: s.id,
						messageToSign: message(venue),
						txInfo: txInfo(venue),
					};
	};
	const recover = async (hash: Hex, signature: Hex) =>
		assert.equal(getAddress(await recoverAddress({ hash, signature })), owner);
	const exact = (body: Record<string, unknown>, p = expected) => {
		assert.ok(p, "every mutation needs a staged Proposal expectation");
		const { signature, ...unsigned } = body;
		assert.equal(typeof signature, "string");
		assert.deepEqual(unsigned, p.submit.body, "every stored body field");
	};
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(req) {
			try {
				const url = new URL(req.url),
					path = url.pathname.replace(/^\/__mainnet/, "");
				const mainnet = url.pathname.startsWith("/__mainnet");
				const json = (data: unknown, status = 200) =>
					Response.json(data, { status });
				if (path.startsWith("/legal/")) {
					if (!state.legalConfigured)
						return json({ error: "legal not configured" }, 503);
					if (req.method === "GET")
						return path === "/legal/terms"
							? json(terms)
							: json({
									accepted: state.accepted,
									...terms,
									acceptedAt: state.accepted
										? new Date(now).toISOString()
										: null,
								});
					const b = (await req.json()) as Record<string, unknown>;
					exact(b);
					assert.deepEqual(
						Object.keys(b).sort(),
						[
							"wallet",
							"termsVersion",
							"privacyVersion",
							"signedAt",
							"signature",
						].sort(),
					);
					if (state.stale) {
						state.stale = false;
						terms.termsVersion = "2026-11";
						return json({ error: "stale_version" }, 409);
					}
					assert.equal(b.wallet, owner);
					assert.equal(b.termsVersion, terms.termsVersion);
					assert.equal(b.privacyVersion, terms.privacyVersion);
					await recover(
						hashTypedData({
							domain: {
								name: "Mobius Legal",
								version: "1",
								chainId: state.legalChain,
							},
							primaryType: "AcceptLegalTerms",
							types: {
								AcceptLegalTerms: fields([
									["statement", "string"],
									["wallet", "address"],
									["termsVersion", "string"],
									["termsUrl", "string"],
									["privacyVersion", "string"],
									["privacyUrl", "string"],
									["signedAt", "uint256"],
								]),
							},
							message: {
								statement,
								wallet: owner,
								...terms,
								signedAt: b.signedAt,
							},
						} as TypedDataDefinition),
						b.signature as Hex,
					);
					writes.push("legal acceptance: signer recovered; exact body");
					state.accepted = true;
					return json({ ok: true });
				}
				if (path === "/info") {
					const b = await req.json();
					return b.type === "clearinghouseState"
						? json({
								marginSummary: { accountValue: state.funded ? "100" : "0" },
							})
						: json({ balances: [] });
				}
				if (path === "/api/v1/account") {
					assert.equal(url.searchParams.get("by"), "l1_address");
					assert.equal(url.searchParams.get("value"), owner);
					return json({
						code: 200,
						accounts: state.account ? [{ index: mainnet ? 22 : 11 }] : [],
					});
				}
				if (path === "/api/binding/rebind-check")
					return state.rebind
						? json({ allowed: true })
						: json({ error: "active tasks prevent rebinding" }, 409);
				if (path.startsWith("/api/binding/")) {
					const [, , , group, route] = path.split("/");
					let venue = (
						group === "lighter" &&
						url.searchParams.get("venue") === "lighter-mainnet"
							? "lighter-mainnet"
							: group
					) as Venue;
					if (route === "status") {
						const pair = [...sessions.entries()].find(
							([, s]) => s.id === url.searchParams.get("sessionId"),
						);
						assert.ok(pair);
						const [v, s] = pair;
						return json({
							status:
								s.agentApproved &&
								(v.startsWith("lighter") || s.builderApproved)
									? "bound"
									: "pending",
							...(v === "hl" && s.agentApproved && !s.builderApproved
								? { needsBuilderFee: true }
								: {}),
						});
					}
					if (route === "credential") {
						assert.equal(url.searchParams.get("ownerAddress"), owner);
						const s = sessions.get(venue);
						if (!s) return json({ bound: false });
						if (
							!s.agentApproved ||
							(!venue.startsWith("lighter") && !s.builderApproved)
						)
							return json({
								bound: false,
								session: { ...prepared(venue), status: "pending" },
							});
						return json(
							venue.startsWith("lighter")
								? {
										bound: true,
										publicKey: `public-${venue}`,
										slot: 3,
										accountIndex: venue === "lighter" ? 11 : 22,
										chainId: venue === "lighter" ? 466324 : 304,
										integratorApproved: s.integratorApproved,
										integratorIndex: 7,
										integratorAddress: builder,
									}
								: {
										bound: true,
										agentAddress: agent,
										builderApproved: s.builderApproved,
										builderAddress: builder,
									},
						);
					}
					assert.equal(req.method, "POST");
					const b = (await req.json()) as Record<string, unknown>;
					if (group === "lighter" && b.venue === "lighter-mainnet")
						venue = "lighter-mainnet";
					if (route === "builder-finalize") {
						assert.deepEqual(b, { ownerAddress: owner });
						assert.deepEqual(expected?.submit.completion?.finalize?.body, b);
						assert.ok(sessions.get(venue)?.builderApproved);
						writes.push(`${venue} builder-finalize: stored plan body`);
						return json({ ok: true });
					}
					exact(b);
					assert.equal(b.timestamp, Math.floor(now / 1000));
					assert.match(String(b.nonce), /^[0-9a-f-]{36}$/);
					if (route === "prepare") {
						assert.deepEqual(
							Object.keys(b).sort(),
							[
								...(group === "lighter"
									? [
											"accountIndex",
											"chainId",
											...(venue === "lighter-mainnet" ? ["venue"] : []),
										]
									: []),
								"nonce",
								"timestamp",
								"signature",
							].sort(),
						);
						if (group === "lighter") {
							assert.equal(b.accountIndex, venue === "lighter" ? 11 : 22);
							assert.equal(b.chainId, venue === "lighter" ? 466324 : 304);
						}
						const msg =
							group === "lighter"
								? `Prepare Lighter binding accountIndex=${b.accountIndex} chainId=${b.chainId} nonce=${b.nonce} timestamp=${b.timestamp}${venue === "lighter-mainnet" ? " venue=lighter-mainnet" : ""}`
								: `Prepare ${group === "hl" ? "HL" : "Aster"} binding nonce=${b.nonce} timestamp=${b.timestamp}`;
						await recover(hashMessage(msg), b.signature as Hex);
						sessions.set(venue, {
							id: `session-${venue}`,
							agentApproved: false,
							builderApproved: false,
							integratorApproved: false,
						});
						writes.push(`${venue} prepare: signer recovered; exact body`);
						return json(prepared(venue));
					}
					// MoB names an integrator on both Lighter deployments.
					assert.equal(route, "integrator-approve");
					assert.ok(venue === "lighter" || venue === "lighter-mainnet");
					assert.equal(b.ownerAddress, owner);
					await recover(
						hashMessage(
							`Approve zero-fee Lighter integrator owner=${owner.toLowerCase()} venue=${venue} integratorIndex=7 nonce=${b.nonce} timestamp=${b.timestamp}`,
						),
						b.signature as Hex,
					);
					writes.push(`${venue} integrator: signer recovered; exact body`);
					if (state.integratorRefused)
						return json(
							{ error: "venue tier does not permit integrator approval" },
							400,
						);
					const s = sessions.get(venue);
					assert.ok(s);
					s.integratorApproved = true;
					return json({
						ok: true,
						integratorIndex: 7,
						expiresAt: now + 86400_000 * 30,
					});
				}
				if (path === "/exchange") {
					const b = await req.json();
					assert.ok(expected);
					assert.deepEqual(Object.keys(b).sort(), [
						"action",
						"nonce",
						"signature",
					]);
					assert.deepEqual(
						{ action: b.action, nonce: b.nonce },
						expected.submit.body,
					);
					assert.equal(b.nonce, now);
					const a = b.action;
					const approval = a.type === "approveAgent";
					assert.equal(a.hyperliquidChain, "Mainnet");
					assert.equal(a.signatureChainId, "0xa4b1");
					if (approval) {
						assert.equal(a.agentAddress, agent);
						assert.equal(
							a.agentName,
							`mobius-bot valid_until ${now + 179 * 86400_000}`,
						);
					} else {
						assert.equal(a.type, "approveBuilderFee");
						assert.equal(a.maxFeeRate, "0.1%");
						assert.equal(a.builder, builder);
					}
					const primaryType = `HyperliquidTransaction:${approval ? "ApproveAgent" : "ApproveBuilderFee"}`;
					const types = {
						[primaryType]: fields(
							approval
								? [
										["hyperliquidChain", "string"],
										["agentAddress", "address"],
										["agentName", "string"],
										["nonce", "uint64"],
									]
								: [
										["hyperliquidChain", "string"],
										["maxFeeRate", "string"],
										["builder", "address"],
										["nonce", "uint64"],
									],
						),
					};
					const signature =
						`${b.signature.r}${b.signature.s.slice(2)}${b.signature.v.toString(16)}` as Hex;
					await recover(
						hashTypedData({
							domain: {
								name: "HyperliquidSignTransaction",
								version: "1",
								chainId: 42161,
								verifyingContract: "0x0000000000000000000000000000000000000000",
							},
							types,
							primaryType,
							message: a,
						}),
						signature,
					);
					const s = sessions.get("hl");
					assert.ok(s);
					if (approval) s.agentApproved = true;
					else s.builderApproved = true;
					writes.push(`hl ${a.type}: typed signer recovered; exact body`);
					return json({ status: "ok", response: { type: "default" } });
				}
				if (path === "/fapi/v3/approveAgent") {
					const form = new URLSearchParams(await req.text());
					assert.deepEqual(
						[...form.keys()].filter(
							(k) => !["signature", "signatureChainId"].includes(k),
						),
						Object.keys(params),
					);
					assert.equal(form.get("signatureChainId"), "56");
					assert.equal(form.size, Object.keys(params).length + 2);
					for (const [key, value] of Object.entries(params))
						assert.equal(form.get(key), String(value), key);
					const entries = Object.entries(params);
					const types = {
						ApproveAgent: entries.map(([key, value]) => ({
							name: key[0].toUpperCase() + key.slice(1),
							type:
								typeof value === "boolean"
									? "bool"
									: typeof value === "number"
										? "uint256"
										: "string",
						})),
					};
					const message = Object.fromEntries(
						entries.map(([key, value]) => [
							key[0].toUpperCase() + key.slice(1),
							value,
						]),
					);
					await recover(
						hashTypedData({
							domain: {
								name: "AsterSignTransaction",
								version: "1",
								chainId: 56,
								verifyingContract: "0x0000000000000000000000000000000000000000",
							},
							types,
							primaryType: "ApproveAgent",
							message,
						}),
						form.get("signature") as Hex,
					);
					const s = sessions.get("aster");
					assert.ok(s);
					s.agentApproved = true;
					s.builderApproved = true;
					writes.push(
						"aster approveAgent: dynamic typed signer recovered; exact ordered form",
					);
					return json({ code: 200, msg: "success" });
				}
				if (path === "/api/v1/sendTx") {
					const venue = mainnet ? "lighter-mainnet" : "lighter";
					const form = new URLSearchParams(await req.text());
					assert.equal(form.size, 2);
					assert.equal(form.get("tx_type"), "8");
					const { L1Sig, ...tx } = JSON.parse(form.get("tx_info") as string);
					assert.deepEqual(tx, txInfo(venue));
					await recover(hashMessage(message(venue)), L1Sig);
					const s = sessions.get(venue);
					assert.ok(s);
					s.agentApproved = true;
					writes.push(`${venue} sendTx: L1Sig recovered; exact tx_info`);
					return json({ code: 200, tx_hash: "test-transaction" });
				}
				throw new Error(`Unexpected endpoint ${req.method} ${path}`);
			} catch (error) {
				const message = String(error);
				errors.push(message);
				return Response.json({ error: message }, { status: 400 });
			}
		},
	});
	const base = `http://127.0.0.1:${server.port}`;
	const fetch: Fetch = (url, init) => {
		const u = new URL(url);
		assert.ok(
			[
				new URL(base).host,
				"api.hyperliquid.xyz",
				"fapi.asterdex.com",
				"api.rh.lighter.xyz",
				"mainnet.zklighter.elliot.ai",
			].includes(u.host),
		);
		return loopbackFetch(
			`${base}${u.host === "mainnet.zklighter.elliot.ai" ? "/__mainnet" : ""}${u.pathname}${u.search}`,
			init,
		);
	};
	return {
		base,
		fetch,
		state,
		terms,
		errors,
		writes,
		expect: (p: Proposal) => {
			expected = p;
		},
		stop: () => server.stop(true),
	};
}
