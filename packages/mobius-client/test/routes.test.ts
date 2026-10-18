import { expect, test } from "bun:test";
import task from "../../../apps/cli/test/fixtures/public-task.json";
import {
	MobiusClient,
	type ReadRoutes,
	readRoutes,
	type WriteRoutes,
	writeRoutes,
} from "../src/index.ts";

const owner = "0x0000000000000000000000000000000000000001";
const reads: {
	[R in keyof ReadRoutes]: { params: ReadRoutes[R]["params"]; result: unknown };
} = {
	"/legal/terms": {
		params: {},
		result: {
			termsVersion: "1",
			termsUrl: "https://mob.exchange/terms",
			privacyVersion: "1",
			privacyUrl: "https://mob.exchange/privacy",
		},
	},
	"/legal/acceptance": {
		params: { wallet: owner },
		result: {
			accepted: false,
			termsVersion: "1",
			privacyVersion: "1",
			acceptedAt: null,
		},
	},
	"/api/arbitrage/list": { params: { owner }, result: [task] },
	"/api/arbitrage/task": { params: { owner, taskId: "t1" }, result: task },
	"/api/arbitrage/liq-trims": {
		params: { owner, taskId: "t1", limit: 50, cursor: "2" },
		result: { attempts: [], nextCursor: null },
	},
	"/api/arbitrage/resizes": {
		params: { owner, taskId: "t1", limit: 50 },
		result: { attempts: [], nextCursor: null, total: 0 },
	},
	"/api/arbitrage/alert-dismissals": {
		params: { owner },
		result: [{ taskId: "t1", kind: "alert" }],
	},
	"/api/arbitrage/rates": {
		params: {},
		result: { observedAt: 1, rates: [], listed: [], failed: [] },
	},
	"/api/binding/hl/credential": {
		params: { ownerAddress: owner },
		result: { bound: false },
	},
	"/api/binding/aster/credential": {
		params: { ownerAddress: owner },
		result: { bound: false },
	},
	"/api/binding/lighter/credential": {
		params: { ownerAddress: owner, venue: "lighter-mainnet" },
		result: { bound: false },
	},
	"/api/binding/hl/status": {
		params: { sessionId: "s 1" },
		result: { status: "pending" },
	},
	"/api/binding/aster/status": {
		params: { sessionId: "s 1" },
		result: { status: "pending" },
	},
	"/api/binding/lighter/status": {
		params: { sessionId: "s 1" },
		result: { status: "pending" },
	},
	"/api/binding/rebind-check": {
		params: { ownerAddress: owner, venue: "hl" },
		result: { allowed: true },
	},
	"/api/binding/readiness": {
		params: { ownerAddress: owner },
		result: {
			ready: false,
			venues: [{ venue: "hl", ready: false, issue: "not_bound" }],
		},
	},
	"/api/agent-grants": { params: { owner }, result: [] },
};
const auth = { timestamp: 1787555739, signature: "0x1234" as const };
const writes: {
	[R in keyof WriteRoutes]: { body: WriteRoutes[R]["body"]; result: unknown };
} = {
	"/api/keys/list": {
		body: {
			owner,
			timestamp: 1787555739,
			signature: `0x${"1".repeat(130)}`,
		},
		result: [],
	},
	"/api/keys/create": {
		body: {
			owner,
			name: "terminal",
			venues: ["hl"],
			maxSizeUsd: 5000,
			nonce: "00000000-0000-4000-8000-000000000001",
			timestamp: 1787555739,
			signature: `0x${"1".repeat(130)}`,
		},
		result: {
			key: `mobius_00000000-0000-4000-8000-000000000002.${"a".repeat(64)}`,
			record: {
				id: "00000000-0000-4000-8000-000000000002",
				name: "terminal",
				venues: ["hl"],
				max_size_usd: "5000",
				key_prefix: "mobius_00000000-0000-4000-8000-000000000002…",
				created_at: "2026-10-12T00:00:00.000Z",
				revoked_at: null,
			},
		},
	},
	"/api/keys/revoke": {
		body: {
			owner,
			id: "00000000-0000-4000-8000-000000000002",
			timestamp: 1787555739,
			signature: `0x${"1".repeat(130)}`,
		},
		result: { ok: true },
	},
	"/legal/acceptance": {
		body: {
			wallet: owner,
			termsVersion: "1",
			privacyVersion: "1",
			signedAt: 1787555739,
			signature: "0x1234",
		},
		result: { ok: true },
	},
	"/api/arbitrage/create": {
		body: {
			...auth,
			longVenue: "hl",
			shortVenue: "lighter",
			longMarket: "xyz:NVDA",
			shortMarket: "NVDA",
			sizeUsd: 1000,
			longPrice: 123,
			shortPrice: 124,
			minFundingApy: 0,
			nonce: "nonce",
			autoClose: false,
		},
		result: { taskId: "t1" },
	},
	"/api/arbitrage/close": {
		body: { ...auth, taskId: "t1" },
		result: { ok: true },
	},
	"/api/arbitrage/neutralize": {
		body: { ...auth, taskId: "t1" },
		result: { ok: true },
	},
	"/api/arbitrage/resize": {
		body: {
			...auth,
			taskId: "t1",
			longTargetBase: 0.1,
			disableSizeMismatchAutoClose: true,
		},
		result: { ok: true },
	},
	"/api/arbitrage/auto-close": {
		body: { ...auth, taskId: "t1", autoClose: false, minFundingApy: 0 },
		result: { ok: true },
	},
	"/api/arbitrage/liq-protection": {
		body: { ...auth, taskId: "t1", liqProtectionPct: null },
		result: { ok: true },
	},
	"/api/arbitrage/size-mismatch-auto-close": {
		body: { ...auth, taskId: "t1", enabled: false, thresholdPct: 0 },
		result: { ok: true },
	},
	"/api/arbitrage/alert-dismiss": {
		body: { owner, taskId: "t1", kind: "alert" },
		result: { ok: true },
	},
	"/api/binding/hl/prepare": {
		body: { ...auth, nonce: "nonce" },
		result: { sessionId: "s1", agentAddress: owner },
	},
	"/api/binding/aster/prepare": {
		body: { ...auth, nonce: "nonce" },
		result: {
			sessionId: "s1",
			agentAddress: owner,
			approvalParams: {},
			baseUrl: "https://fapi.asterdex.com",
			signingChainId: 56,
		},
	},
	"/api/binding/lighter/prepare": {
		body: {
			...auth,
			nonce: "nonce",
			accountIndex: 1,
			chainId: 304,
			venue: "lighter-mainnet",
		},
		result: { sessionId: "s1", messageToSign: "msg", txInfo: {} },
	},
	"/api/binding/lighter/integrator-approve": {
		body: {
			...auth,
			nonce: "nonce",
			ownerAddress: owner,
			venue: "lighter-mainnet",
		},
		result: { ok: true, integratorIndex: 1, expiresAt: 1787555739 },
	},
	"/api/binding/hl/builder-finalize": {
		body: { ownerAddress: owner },
		result: { ok: true },
	},
	"/api/binding/aster/builder-finalize": {
		body: { ownerAddress: owner },
		result: { ok: true },
	},
	"/api/agent-grants/create": {
		body: {
			owner,
			agent: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
			scopes: ["open", "close"],
			maxOpenNotionalUsd: 5000,
			maxOpenTasks: 3,
			venues: ["hl", "lighter"],
			markets: "*",
			expires: 1787642139,
			nonce: "01234567-89ab-4cde-8123-456789abcdef",
			timestamp: 1787555739,
			signature: `0x${"1".repeat(130)}`,
		},
		result: {
			grant: {
				grantId: "g-1",
				owner,
				agent: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
				scopes: ["open", "close"],
				maxOpenNotionalUsd: 5000,
				maxOpenTasks: 3,
				venues: ["hl", "lighter"],
				markets: "*",
				expiresAt: "2026-08-24T00:00:00.000Z",
				revokedAt: null,
			},
		},
	},
	"/api/agent-grants/revoke": {
		body: {
			owner,
			agent: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
			timestamp: 1787555739,
			signature: `0x${"1".repeat(130)}`,
		},
		result: { ok: true },
	},
};
test.each(Object.keys(readRoutes) as (keyof ReadRoutes)[])(
	"typed read %s uses exact query fields",
	async (route) => {
		const fixture = reads[route];
		const client = new MobiusClient({
			version: "0.2.0",
			limit: async () => {},
			fetch: async (url, init) => {
				expect(new URL(url).pathname).toBe(route);
				expect(init?.method).toBe("GET");
				expect(init?.body).toBeUndefined();
				expect(init?.signal).toBeDefined();
				expect(Object.fromEntries(new URL(url).searchParams)).toEqual(
					Object.fromEntries(
						Object.entries(fixture.params).map(([k, v]) => [k, String(v)]),
					),
				);
				return Response.json(fixture.result);
			},
		});
		expect<unknown>(await client.read(route, fixture.params)).toEqual(
			fixture.result,
		);
	},
);
test.each(Object.keys(writeRoutes) as (keyof WriteRoutes)[])(
	"typed write %s preserves request body",
	async (route) => {
		const fixture = writes[route];
		let count = 0;
		const client = new MobiusClient({
			version: "0.2.0",
			limit: async () => {},
			fetch: async (url, init) => {
				count++;
				expect(new URL(url).pathname).toBe(route);
				expect(init?.method).toBe("POST");
				expect(JSON.parse(String(init?.body))).toEqual(fixture.body);
				return Response.json(fixture.result);
			},
		});
		expect<unknown>(await client.write(route, fixture.body)).toEqual(
			fixture.result,
		);
		expect(count).toBe(1);
	},
);
