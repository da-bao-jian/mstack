import { expect, test } from "bun:test";
import {
	bindingMessage,
	canonical,
	classifySignRequest,
	preparePayload,
	readHeaders,
	readPayload,
} from "../src/index.ts";

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

test("classifySignRequest validates but does not rebuild the payload", () => {
	const typed = {
		requestId: "hl:approveAgent",
		venue: "hl",
		action: "approveAgent",
		method: "eth_signTypedData_v4",
		payload: {
			domain: {},
			types: {},
			primaryType: "Agent",
			message: { agent: "0x1" },
		},
	} as const;
	expect(classifySignRequest(typed)).toEqual({
		method: typed.method,
		venue: typed.venue,
		action: typed.action,
		requestId: typed.requestId,
	});
	expect(
		classifySignRequest({
			requestId: "lighter:changePubKey",
			venue: "lighter",
			action: "changePubKey",
			method: "personal_sign",
			payload: { message: "exact bytes" },
		}),
	).toEqual({
		method: "personal_sign",
		venue: "lighter",
		action: "changePubKey",
		requestId: "lighter:changePubKey",
	});
	expect(() =>
		classifySignRequest({ ...typed, payload: { message: {} } }),
	).toThrow("typed data");
});
