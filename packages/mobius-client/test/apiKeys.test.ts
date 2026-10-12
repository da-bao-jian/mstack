import { expect, test } from "bun:test";
import { apiKeyMessage, MobiusClient, type Secret } from "../src/index.ts";

const owner = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const timestamp = 1_791_800_000;

test("apiKeyMessage pins the upstream byte strings", () => {
	expect(apiKeyMessage("list", { owner, timestamp })).toBe(
		`Mobius API keys: list owner=${owner.toLowerCase()} timestamp=${timestamp}`,
	);
	expect(
		apiKeyMessage("create", {
			owner,
			timestamp,
			name: "terminal",
			venues: ["hl", "lighter"],
			nonce: "00000000-0000-4000-8000-000000000001",
		}),
	).toBe(
		`Mobius API keys: create owner=${owner.toLowerCase()} name="terminal" venues=hl,lighter nonce=00000000-0000-4000-8000-000000000001 timestamp=${timestamp}`,
	);
	expect(
		apiKeyMessage("create", {
			owner,
			timestamp,
			name: "terminal",
			venues: ["aster"],
			maxSizeUsd: 5000,
			nonce: "00000000-0000-4000-8000-000000000001",
		}),
	).toBe(
		`Mobius API keys: create owner=${owner.toLowerCase()} name="terminal" venues=aster maxSizeUsd=5000 nonce=00000000-0000-4000-8000-000000000001 timestamp=${timestamp}`,
	);
	expect(
		apiKeyMessage("revoke", {
			owner,
			timestamp,
			id: "00000000-0000-4000-8000-000000000002",
		}),
	).toBe(
		`Mobius API keys: revoke owner=${owner.toLowerCase()} id=00000000-0000-4000-8000-000000000002 timestamp=${timestamp}`,
	);
});

test("API key routes validate one-time secret and records", async () => {
	const secret =
		"mobius_00000000-0000-4000-8000-000000000002.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
	const client = new MobiusClient({
		version: "0.3.0",
		limit: async () => {},
		fetch: async (url) => {
			if (url.endsWith("/api/keys/create"))
				return Response.json(
					{
						key: secret,
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
					{ status: 201 },
				);
			if (url.endsWith("/api/keys/list")) return Response.json([]);
			return Response.json({ ok: true });
		},
	});
	const body = {
		owner,
		name: "terminal",
		venues: ["hl" as const],
		maxSizeUsd: 5000,
		nonce: "00000000-0000-4000-8000-000000000001",
		timestamp,
		signature: `0x${"1".repeat(130)}` as const,
	};
	const created = await client.write("/api/keys/create", body);
	const typed: Secret<string> = created.key;
	expect(String(typed)).toBe(secret);
	expect(
		await client.write("/api/keys/list", {
			owner,
			timestamp,
			signature: body.signature,
		}),
	).toEqual([]);
	expect(
		await client.write("/api/keys/revoke", {
			owner,
			id: created.record.id,
			timestamp,
			signature: body.signature,
		}),
	).toEqual({ ok: true });
});

test("a malformed create response cannot put the one-time key in an error", async () => {
	const secret = `mobius_00000000-0000-4000-8000-000000000002.${"a".repeat(64)}`;
	const client = new MobiusClient({
		version: "0.3.0",
		limit: async () => {},
		fetch: async () =>
			Response.json({ key: secret, record: null }, { status: 201 }),
	});
	try {
		await client.write("/api/keys/create", {
			owner,
			name: "terminal",
			venues: ["hl"],
			nonce: "00000000-0000-4000-8000-000000000001",
			timestamp,
			signature: `0x${"1".repeat(130)}`,
		});
		throw new Error("expected failure");
	} catch (error) {
		expect(String(error)).not.toContain(secret);
		expect(JSON.stringify(error)).not.toContain(secret);
	}
});
