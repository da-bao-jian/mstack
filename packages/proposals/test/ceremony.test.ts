import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindingMessage, preparePayload } from "@mstack/mobius-api";
import { privateKeyToAccount } from "viem/accounts";
import {
	asterRequest,
	hlRequest,
} from "../../mobius-api/test/fake-api-helpers.ts";
import { CeremonyStore, ceremonyFingerprint } from "../src/ceremony.ts";
import { digest } from "../src/model.ts";

const account = privateKeyToAccount(`0x${"03".repeat(32)}`);
const now = 1_800_000_000_000;
const homes: string[] = [];
afterEach(async () => {
	await Promise.all(
		homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
	);
});

async function store() {
	const home = await mkdtemp(join(tmpdir(), "mstack-ceremony-"));
	homes.push(home);
	return { home, store: new CeremonyStore(home, () => now) };
}

test("ceremony stage fixes prepare bytes, expiry, targets and idempotency keys", async () => {
	const h = await store();
	const ceremony = await h.store.stage({
		owner: account.address,
		apiBase: "http://127.0.0.1:9988",
		venues: [
			{ venue: "hl", signatureChainId: 42161 },
			{ venue: "lighter", accountIndex: 123 },
		],
	});
	expect(ceremony.id).toBe("c-1");
	expect(ceremony.status).toBe("awaiting-prepare-signature");
	expect(ceremony.expiresAt).toBe(now + 300_000);
	expect(ceremony.submitIdempotencyKey).toMatch(/^c-1:[0-9a-f-]{36}$/);
	expect(ceremony.prepareIdempotencyKey).toMatch(/^c-1:prepare:[0-9a-f-]{36}$/);
	const payload = preparePayload(
		{
			owner: account.address,
			venues: ceremony.venues,
			nonce: ceremony.nonce,
			expiresAt: ceremony.expiresAt / 1000,
		},
		() => now,
	);
	expect(ceremony.prepare?.signing).toEqual({
		type: "text",
		message: bindingMessage("prepare", payload),
	});
	expect(ceremony.prepare?.submit).toEqual({ type: "prepare-ceremony" });
	expect(ceremony.requests).toEqual([]);
	expect((await stat(join(h.home, "ceremonies"))).mode & 0o777).toBe(0o700);
	expect(
		(await stat(join(h.home, "ceremonies", "c-1.json"))).mode & 0o777,
	).toBe(0o600);
});

test("ceremony records returned requests in order as collect-only Proposals", async () => {
	const h = await store();
	const ceremony = await h.store.stage({
		owner: account.address,
		apiBase: "http://127.0.0.1:9988",
		venues: [{ venue: "hl" }],
	});
	const updated = await h.store.recordPrepared(ceremony.id, {
		bindingId: "01234567-89ab-cdef-0123-456789abcdef",
		owner: account.address,
		expiresAt: new Date(ceremony.expiresAt).toISOString(),
		status: "awaiting_signatures",
		results: [
			{
				venue: "hl",
				sessionId: "11234567-89ab-cdef-0123-456789abcdef",
				status: "awaiting_signatures",
			},
		],
		signRequests: [hlRequest("approveAgent"), hlRequest("approveBuilderFee")],
	});
	expect(updated.bindingId).toBe("01234567-89ab-cdef-0123-456789abcdef");
	expect(updated.status).toBe("awaiting-request-signatures");
	expect(updated.requests.map((step) => step.requestId)).toEqual([
		"hl:approveAgent",
		"hl:approveBuilderFee",
	]);
	expect(updated.requests.map((step) => step.kind)).toEqual([
		"sign-typed",
		"sign-typed",
	]);
	expect(updated.requests[0]?.purpose).toBe(
		"Bind hl: approveAgent (trades on Hyperliquid; an agent cannot withdraw)",
	);
	expect(
		updated.requests.every((step) => step.submit.type === "collect-ceremony"),
	).toBe(true);
	expect(updated.requests.map((step) => step.status)).toEqual([
		"awaiting-signature",
		"awaiting-signature",
	]);
});

test("ceremony refuses a prepared request outside the binding allow-list", async () => {
	const h = await store();
	const ceremony = await h.store.stage({
		owner: account.address,
		apiBase: "http://127.0.0.1:9988",
		venues: [{ venue: "aster" }],
	});
	const request = asterRequest(account.address);
	(
		request.payload as { message: Record<string, unknown> }
	).message.CanWithdraw = true;
	await expect(
		h.store.recordPrepared(ceremony.id, {
			bindingId: "01234567-89ab-cdef-0123-456789abcdef",
			owner: account.address,
			expiresAt: new Date(ceremony.expiresAt).toISOString(),
			status: "awaiting_signatures",
			results: [],
			signRequests: [request],
		}),
	).rejects.toThrow("Unexpected Aster approveAgent request");
});

test("a stored request rewritten consistently on disk is refused when the ceremony loads", async () => {
	const h = await store();
	const ceremony = await h.store.stage({
		owner: account.address,
		apiBase: "http://127.0.0.1:9988",
		venues: [{ venue: "aster" }],
	});
	await h.store.recordPrepared(ceremony.id, {
		bindingId: "01234567-89ab-cdef-0123-456789abcdef",
		owner: account.address,
		expiresAt: new Date(ceremony.expiresAt).toISOString(),
		status: "awaiting_signatures",
		results: [],
		signRequests: [asterRequest(account.address)],
	});
	const path = join(h.home, "ceremonies", `${ceremony.id}.json`);
	const { recordHash: _, ...stored } = JSON.parse(await readFile(path, "utf8"));
	const step = stored.requests[0];
	step.signing.typedData.message.CanWithdraw = true;
	step.digest = digest(step.signing);
	const bytes = `${JSON.stringify(stored, null, 2)}\n`;
	const recordHash = createHash("sha256").update(bytes).digest("hex");
	await writeFile(
		path,
		`${JSON.stringify({ ...stored, recordHash }, null, 2)}\n`,
		{ mode: 0o600 },
	);
	await expect(h.store.get(ceremony.id)).rejects.toThrow(
		"Unexpected Aster approveAgent request",
	);
});

test("ceremony checksum rejects record edits", async () => {
	const h = await store();
	const ceremony = await h.store.stage({
		owner: account.address,
		apiBase: "http://127.0.0.1:9988",
		venues: [{ venue: "aster" }],
	});
	const path = join(h.home, "ceremonies", `${ceremony.id}.json`);
	const raw = await readFile(path, "utf8");
	await writeFile(path, raw.replace("aster", "hl"), { mode: 0o600 });
	await expect(h.store.get(ceremony.id)).rejects.toThrow("integrity");
});

test("ceremony stage carries a legal step and a key plan that round-trip through storage", async () => {
	const h = await store();
	const signing = {
		type: "typed" as const,
		typedData: {
			domain: { name: "Mobius Legal", version: "1", chainId: 97 },
			types: { AcceptLegalTerms: [{ name: "statement", type: "string" }] },
			primaryType: "AcceptLegalTerms",
			message: { statement: "I agree" },
		},
	};
	const ceremony = await h.store.stage({
		owner: account.address,
		apiBase: "http://127.0.0.1:9988",
		venues: [{ venue: "lighter", accountIndex: 123 }],
		legal: {
			signing,
			base: "https://auth.example.test",
			body: { wallet: account.address, signedAt: now / 1000 },
		},
		keyPlan: { name: "mstack", maxSizeUsd: 5000 },
	});
	expect(ceremony.legal?.id).toBe("c-1:legal");
	expect(ceremony.legal?.kind).toBe("sign-typed");
	expect(ceremony.legal?.expiresAt).toBe(ceremony.expiresAt);
	expect(ceremony.legal?.submit).toEqual({
		type: "legal-ceremony",
		base: "https://auth.example.test",
		body: { wallet: account.address, signedAt: now / 1000 },
	});
	expect(ceremony.keyPlan).toEqual({ name: "mstack", maxSizeUsd: 5000 });
	expect(ceremony.key).toBeUndefined();
	const stored = await h.store.get("c-1");
	expect(stored.legal).toEqual(ceremony.legal);
	expect(stored.keyPlan).toEqual(ceremony.keyPlan);
	// A key step created later carries its own window inside the record.
	await h.store
		.update("c-1", (record) => {
			record.key = {
				id: "c-1:key",
				kind: "sign-text",
				owner: record.owner,
				purpose: "Create API key",
				createdAt: now + 60_000,
				expiresAt: now + 360_000,
				digest:
					"0x0000000000000000000000000000000000000000000000000000000000000000",
				signing: { type: "text", message: "Mobius API keys: create" },
				status: "awaiting-signature",
				submit: {
					type: "key-ceremony",
					base: "https://funding.example.test",
					body: {},
				},
			};
		})
		.catch((error) => error);
	await expect(h.store.get("c-1")).resolves.toMatchObject({ id: "c-1" });
	await expect(
		h.store.stage({
			owner: account.address,
			apiBase: "http://127.0.0.1:9988",
			venues: [{ venue: "lighter", accountIndex: 123 }],
			keyPlan: { name: "", maxSizeUsd: 5000 },
		}),
	).rejects.toThrow("key plan");
});

test("ceremony fingerprint pins owner, venues, prepare, legal and key plan", async () => {
	const h = await store();
	const plain = await h.store.stage({
		owner: account.address,
		apiBase: "http://127.0.0.1:9988",
		venues: [{ venue: "hl", signatureChainId: 42161 }],
	});
	const first = ceremonyFingerprint(plain);
	expect(first).toMatch(/^0x[0-9a-f]{64}$/);
	expect(ceremonyFingerprint(await h.store.get(plain.id))).toBe(first);
	const planned = await h.store.stage({
		owner: account.address,
		apiBase: "http://127.0.0.1:9988",
		venues: [{ venue: "hl", signatureChainId: 42161 }],
		keyPlan: { name: "mstack", maxSizeUsd: 2000 },
	});
	expect(ceremonyFingerprint(planned)).not.toBe(first);
	expect(
		ceremonyFingerprint({
			...planned,
			keyPlan: { name: "mstack", maxSizeUsd: 2001 },
		}),
	).not.toBe(ceremonyFingerprint(planned));
});
