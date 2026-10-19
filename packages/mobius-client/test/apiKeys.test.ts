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

/** True when any 16-character run of the secret survives in the text. */
function leaksSecret(text: string, secret: string): boolean {
	for (let i = 0; i + 16 <= secret.length; i++)
		if (text.includes(secret.slice(i, i + 16))) return true;
	return false;
}

test("a key creation answer is never echoed, even when the key crosses the excerpt cut", async () => {
	const uuid = "00000000-0000-4000-8000-000000000001";
	const secret = "0123456789abcdef".repeat(4);
	for (let pad = 100; pad <= 220; pad += 3) {
		// Schema drift: the record comes first and fails validation.
		const raw = JSON.stringify({
			record: { id: uuid, name: "d".repeat(pad), max_size_usd: 1000 },
			key: `mobius_${uuid}.${secret}`,
		});
		const client = new MobiusClient({
			version: "0.3.0",
			limit: async () => {},
			fetch: async () => new Response(raw, { status: 200 }),
		});
		const error = await client
			.write("/api/keys/create", {
				owner,
				name: "terminal",
				venues: ["hl"],
				nonce: "00000000-0000-4000-8000-000000000001",
				timestamp,
				signature: `0x${"1".repeat(130)}`,
			})
			.catch((caught) => caught);
		expect(error).toBeInstanceOf(Error);
		expect(String(error)).toContain("body not shown for key creation");
		expect(String(error)).not.toContain("ddd");
		expect(leaksSecret(String(error), secret)).toBe(false);
		expect(leaksSecret(JSON.stringify(error), secret)).toBe(false);
	}
});
