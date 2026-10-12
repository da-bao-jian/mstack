import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindingMessage, preparePayload } from "@mstack/mobius-api";
import { privateKeyToAccount } from "viem/accounts";
import { CeremonyStore } from "../src/ceremony.ts";

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
		venues: [{ venue: "hl", signatureChainId: 42161 }, { venue: "lighter" }],
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
	expect(ceremony.prepare.signing).toEqual({
		type: "text",
		message: bindingMessage("prepare", payload),
	});
	expect(ceremony.prepare.submit).toEqual({ type: "prepare-ceremony" });
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
		signRequests: [
			{
				requestId: "hl:approveAgent",
				venue: "hl",
				action: "approveAgent",
				method: "eth_signTypedData_v4",
				payload: {
					domain: { name: "HL", chainId: 42161 },
					types: { Agent: [{ name: "owner", type: "address" }] },
					primaryType: "Agent",
					message: { owner: account.address },
				},
			},
			{
				requestId: "hl:fee",
				venue: "hl",
				action: "approveBuilderFee",
				method: "personal_sign",
				payload: { message: "exact fee bytes" },
			},
		],
	});
	expect(updated.bindingId).toBe("01234567-89ab-cdef-0123-456789abcdef");
	expect(updated.status).toBe("awaiting-request-signatures");
	expect(updated.requests.map((step) => step.requestId)).toEqual([
		"hl:approveAgent",
		"hl:fee",
	]);
	expect(updated.requests.map((step) => step.kind)).toEqual([
		"sign-typed",
		"sign-text",
	]);
	expect(
		updated.requests.every((step) => step.submit.type === "collect-ceremony"),
	).toBe(true);
	expect(updated.requests.map((step) => step.status)).toEqual([
		"awaiting-signature",
		"awaiting-signature",
	]);
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
