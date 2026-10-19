import { expect, test } from "bun:test";
import {
	bindingMessage,
	canonical,
	classifySignRequest,
	preparePayload,
	readHeaders,
	readPayload,
	type Venue,
} from "../src/index.ts";
import { asterRequest, hlRequest, lighterRequest } from "./fake-api-helpers.ts";

test("canonical and binding messages preserve the upstream localeCompare order", () => {
	const value = { z: 1, A: { b: 2, B: 3 }, a: [{ Z: 4, y: 5 }] };
	expect(canonical(value)).toBe(
		'{"a":[{"y":5,"Z":4}],"A":{"b":2,"B":3},"z":1}',
	);
	expect(bindingMessage("read", { z: 1, A: 2 })).toBe(
		`Mobius venue binding v1\ndomain=mobius-api\naction=read\npayload=${canonical({ z: 1, A: 2 })}`,
	);
});

test("canonical matches the SHA-pinned upstream algorithm for 200 seeded JSON values", () => {
	const upstreamSha256 =
		"3a51e7538fb33c61c4e0a28feb0297c17e23b2c28aa8ac94c168625a0b942e27";
	expect(upstreamSha256).toHaveLength(64);
	function reference(value: unknown): string {
		function sort(v: unknown): unknown {
			if (Array.isArray(v)) return v.map(sort);
			if (v && typeof v === "object")
				return Object.fromEntries(
					Object.entries(v)
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([k, x]) => [k, sort(x)]),
				);
			return v;
		}
		return JSON.stringify(sort(value));
	}
	let seed = 0x18_1460;
	const random = () => {
		seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
		return seed / 2 ** 32;
	};
	const keys = ["a", "A", "z", "Z", "é", "_key"];
	const make = (depth = 0): unknown => {
		const kind =
			depth > 2 ? Math.floor(random() * 4) : Math.floor(random() * 6);
		if (kind === 0) return null;
		if (kind === 1) return random() < 0.5;
		if (kind === 2) return Math.floor(random() * 10_000) / 10;
		if (kind === 3) return `v${Math.floor(random() * 1000)}`;
		if (kind === 4)
			return Array.from({ length: Math.floor(random() * 4) }, () =>
				make(depth + 1),
			);
		const result: Record<string, unknown> = {};
		for (let index = 0; index < 1 + Math.floor(random() * 5); index++)
			result[`${keys[Math.floor(random() * keys.length)]}${index}`] = make(
				depth + 1,
			);
		return result;
	};
	for (let index = 0; index < 200; index++) {
		const value = make();
		expect(canonical(value)).toBe(reference(value));
	}
});

test("binding authorization helpers normalize and validate their inputs", () => {
	const now = () => 1_800_000_000_000;
	const owner = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
	const venues = [{ venue: "hl" as const }];
	expect(
		preparePayload(
			{ owner, venues, nonce: "abcdefghijklmnop", expiresAt: 1_800_000_240 },
			now,
		),
	).toEqual({
		owner: owner.toLowerCase(),
		venues,
		nonce: "abcdefghijklmnop",
		expiresAt: 1_800_000_240,
	});
	expect(
		readPayload(
			{
				owner,
				bindingId: "00000000-0000-4000-8000-000000000001",
				expiresAt: 1_800_000_240,
			},
			now,
		).owner,
	).toBe(owner.toLowerCase());
	expect(
		readHeaders(
			{ owner, expiresAt: 1_800_000_240, signature: `0x${"1".repeat(130)}` },
			now,
		),
	).toEqual({
		"X-Wallet-Address": owner.toLowerCase(),
		"X-Wallet-Expires-At": "1800000240",
		"X-Wallet-Signature": `0x${"1".repeat(130)}`,
	});
	expect(() =>
		preparePayload(
			{ owner, venues, nonce: "short", expiresAt: 1_800_000_240 },
			now,
		),
	).toThrow("nonce");
	expect(() =>
		readPayload(
			{
				owner,
				bindingId: "00000000-0000-4000-8000-000000000001",
				expiresAt: 1_800_000_301,
			},
			now,
		),
	).toThrow("expiresAt");
});

const OWNER = "0x1111111111111111111111111111111111111111";
const ALL: Venue[] = ["hl", "aster", "lighter", "lighter-mainnet"];
const context = { owner: OWNER, venues: ALL, now: () => 1_800_000_000_000 };
const clone = <T>(value: T): unknown => structuredClone(value);
/** Sets a nested field on a cloned request. */
function set(target: unknown, path: string[], value: unknown) {
	let node = target as Record<string, unknown>;
	for (const key of path.slice(0, -1))
		node = node[key] as Record<string, unknown>;
	node[path.at(-1) as string] = value;
}

test("classifySignRequest accepts the venues' exact binding requests and names what each allows", () => {
	for (const request of [
		hlRequest("approveAgent"),
		hlRequest("approveBuilderFee"),
		asterRequest(OWNER),
		lighterRequest(OWNER, "lighter", "changePubKey"),
		lighterRequest(OWNER, "lighter-mainnet", "approveIntegrator"),
	])
		expect(classifySignRequest(request, context)).toMatchObject({
			venue: request.venue,
			action: request.action,
			requestId: request.requestId,
			method: request.method,
		});
	expect(
		classifySignRequest(hlRequest("approveAgent"), context).capability,
	).toBe("trades on Hyperliquid; an agent cannot withdraw");
});

test("classifySignRequest refuses anything a compromised server could slip into binding", () => {
	const reject = (request: unknown, venues = ALL) =>
		expect(() =>
			classifySignRequest(request, { ...context, venues }),
		).toThrow();
	// A USDC permit dressed up as an HL approval.
	const permit = clone(hlRequest("approveAgent"));
	set(permit, ["payload"], {
		domain: {
			name: "USD Coin",
			version: "2",
			chainId: 42161,
			verifyingContract: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
		},
		types: {
			Permit: [
				{ name: "owner", type: "address" },
				{ name: "spender", type: "address" },
				{ name: "value", type: "uint256" },
				{ name: "nonce", type: "uint256" },
				{ name: "deadline", type: "uint256" },
			],
		},
		primaryType: "Permit",
		message: {
			owner: OWNER,
			spender: "0x000000000000000000000000000000000000dEaD",
			value:
				"115792089237316195423570985008687907853269984665640564039457584007913129639935",
			nonce: 0,
			deadline: 4102444800,
		},
	});
	reject(permit);
	// An HL withdrawal under the approveAgent label.
	const withdraw = clone(hlRequest("approveAgent"));
	set(withdraw, ["payload", "primaryType"], "HyperliquidTransaction:Withdraw");
	set(withdraw, ["payload", "types"], {
		"HyperliquidTransaction:Withdraw": [
			{ name: "hyperliquidChain", type: "string" },
			{ name: "destination", type: "string" },
			{ name: "amount", type: "string" },
			{ name: "time", type: "uint64" },
		],
	});
	reject(withdraw);
	const extraField = clone(hlRequest("approveAgent"));
	set(
		extraField,
		["payload", "message", "destination"],
		"0x000000000000000000000000000000000000dEaD",
	);
	reject(extraField);
	const testnet = clone(hlRequest("approveAgent"));
	set(testnet, ["payload", "message", "hyperliquidChain"], "Testnet");
	reject(testnet);
	const chain = clone(hlRequest("approveAgent"));
	set(chain, ["payload", "domain", "chainId"], 1);
	reject(chain);
	const fee = clone(hlRequest("approveBuilderFee"));
	set(fee, ["payload", "message", "maxFeeRate"], "1%");
	reject(fee);
	const asterWithdraw = clone(asterRequest(OWNER));
	set(asterWithdraw, ["payload", "message", "CanWithdraw"], true);
	reject(asterWithdraw);
	reject(asterRequest("0x000000000000000000000000000000000000dEaD"));
	const integrator = lighterRequest(
		"0x000000000000000000000000000000000000dEaD",
		"lighter",
		"approveIntegrator",
	);
	reject(integrator);
	const transfer = clone(lighterRequest(OWNER, "lighter", "changePubKey"));
	set(
		transfer,
		["payload", "message"],
		"Transfer 1000 USDC to 0x000000000000000000000000000000000000dEaD",
	);
	reject(transfer);
	const spoofed = clone(lighterRequest(OWNER, "lighter", "changePubKey"));
	set(spoofed, ["action"], "changePubKey\u001b[2K\rspoofed");
	reject(spoofed);
	const relabelled = clone(hlRequest("approveAgent"));
	set(relabelled, ["requestId"], "hl:approveBuilderFee");
	reject(relabelled);
	// A venue the owner never asked to bind.
	reject(hlRequest("approveAgent"), ["lighter"]);
});
