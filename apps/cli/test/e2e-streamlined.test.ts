import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prefixOf } from "@mstack/keys";
import { CeremonyStore, ProposalStore } from "@mstack/proposals";
import { importKeystore } from "@mstack/signers";
import { metadataContext } from "../../../packages/funding/test/metadata-fixtures.ts";
import {
	fakeOwnerKey,
	fakeStrategyApi,
	loopbackFetch as strategyFetch,
} from "../../../packages/mobius-api/test/fake-api.ts";
import { setConfig } from "../src/config.ts";
import { cliKeyStore } from "../src/key-store.ts";
import type { Runtime } from "../src/run.ts";
import { run } from "../src/run.ts";
import {
	fakePositionServer,
	loopbackFetch as fundingFetch,
} from "./fixtures/fake-funding-server.ts";

// End-to-end journey for the streamlined signing and onboarding UX:
// one wallet session onboards (legal, binding, key), the key path opens with
// one consent, an expired Proposal is restaged with the same intent, and the
// risk interview is due once per day. Everything runs against local fakes.

const homes: string[] = [];
const servers: { stop(): void }[] = [];
afterEach(async () => {
	for (const server of servers.splice(0)) server.stop();
	await Promise.all(
		homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
	);
});

test("onboard once, open with one consent, restage after expiry, interview once per day", async () => {
	let now = 1_800_000_000_000;
	const strategy = fakeStrategyApi({ now: () => now });
	servers.push(strategy);
	const funding = fakePositionServer(strategy.owner.address, () => now);
	servers.push(funding);
	const metadata = await metadataContext();
	const home = await mkdtemp(join(tmpdir(), "mstack-e2e-"));
	homes.push(home);
	const password = "e2e keystore password";
	const creation = [fakeOwnerKey, password, password];
	await importKeystore(home, async () => creation.shift() ?? "");
	for (const [key, value] of [
		["signer", "keystore"],
		["policy", "manual"],
		["key_store", "file"],
		["api_base", funding.base],
		["strategy_api_base", strategy.base],
		["auth_base", "https://auth.example.test"],
	] as const)
		await setConfig(key, value, home);
	let legalAccepted = false;
	const calls: string[] = [];
	const fetch: Runtime["fetch"] = async (input, init) => {
		const url = new URL(String(input));
		const method = init?.method ?? "GET";
		calls.push(`${method} ${url.host}${url.pathname}`);
		if (url.host === "auth.example.test") {
			if (url.pathname === "/legal/acceptance" && method !== "POST")
				return Response.json({
					accepted: legalAccepted,
					termsVersion: "2026-10-12",
					privacyVersion: "2026-10-12",
					acceptedAt: legalAccepted ? "2026-10-12T00:00:00.000Z" : null,
				});
			if (url.pathname === "/legal/terms")
				return Response.json({
					termsVersion: "2026-10-12",
					termsUrl: "https://mob.exchange/terms",
					privacyVersion: "2026-10-12",
					privacyUrl: "https://mob.exchange/privacy",
				});
			if (url.pathname === "/legal/acceptance") {
				const body = JSON.parse(String(init?.body));
				if (typeof body.signature !== "string")
					return Response.json({ error: "no signature" }, { status: 400 });
				legalAccepted = true;
				return Response.json({ ok: true });
			}
		}
		if (url.href.startsWith(strategy.base)) return strategyFetch(input, init);
		if (url.href.startsWith(funding.base)) {
			if (url.pathname === "/api/keys/create" && method === "POST") {
				const body = JSON.parse(String(init?.body));
				if (typeof body.signature !== "string" || !body.nonce)
					return Response.json({ error: "no signature" }, { status: 400 });
				return Response.json({
					key: strategy.key,
					record: {
						id: "01234567-89ab-cdef-0123-456789abcdef",
						name: body.name,
						venues: body.venues,
						max_size_usd: String(body.maxSizeUsd),
						key_prefix: prefixOf(strategy.key),
						created_at: "2030-01-01T00:00:00Z",
						revoked_at: null,
					},
				});
			}
			if (url.pathname === "/api/binding/readiness")
				return Response.json({
					ready: strategy.bound.has("hl") && strategy.bound.has("lighter"),
					venues: ["hl", "lighter"].map((venue) => ({
						venue,
						ready: strategy.bound.has(venue as "hl" | "lighter"),
						bound: strategy.bound.has(venue as "hl" | "lighter"),
					})),
				});
			return fundingFetch(input, init);
		}
		return metadata.fetch(input, init);
	};
	const invoke = async (args: string[]) => {
		const out: string[] = [];
		const err: string[] = [];
		const code = await run(args, {
			home,
			now: () => now,
			fetch,
			sleep: async () => {},
			stdinIsTTY: false,
			stdoutIsTTY: false,
			out: (line) => out.push(line),
			err: (line) => err.push(line),
			readSecret: async () => password,
		});
		return { code, out: out.join("\n"), err: err.join("\n") };
	};

	// 1. Onboarding: one ceremony, one authorization, no key paste.
	const staged = await invoke([
		"onboard",
		"--native",
		"--owner",
		strategy.owner.address,
		"--venues",
		"hl,lighter",
		"--max-size",
		"2000",
	]);
	expect(staged.code).toBe(0);
	expect(staged.out).toContain(
		"One wallet session: accept legal terms, then bind hl, lighter, then create key “mstack” (cap $2,000) and store it locally.",
	);
	expect(staged.out).toContain("Next: mob sign c-1");
	const signed = await invoke(["sign", "c-1"]);
	expect(signed.code).toBe(0);
	expect(signed.out).toContain("Legal terms accepted.");
	expect(signed.out).toContain("c-1 complete · 2 venues bound");
	expect(signed.out).toContain(
		`Ready · 2 venues bound · key ${prefixOf(strategy.key)} · cap $2,000`,
	);
	expect(signed.out).not.toContain(strategy.key);
	expect((await new CeremonyStore(home, () => now).get("c-1")).status).toBe(
		"complete",
	);
	const stored = await (await cliKeyStore({ home } as Runtime)).get(
		strategy.owner.address,
	);
	expect(stored?.meta).toMatchObject({
		venues: ["hl", "lighter"],
		maxSizeUsd: 2000,
	});
	expect(calls.indexOf("POST auth.example.test/legal/acceptance")).toBeLessThan(
		calls.findIndex((call) => call.endsWith("/v1/venue-bindings/prepare")),
	);
	expect(await new ProposalStore(home, () => now).list()).toHaveLength(0);

	// 2. The risk interview is due once per owner per day.
	const hello = async () =>
		JSON.parse((await invoke(["hello", "--json", "--offline"])).out)
			.riskInterview;
	expect(await hello()).toEqual({ due: true, acknowledgedAt: null });
	expect((await invoke(["risk-ack"])).out).toContain("due again in 24 hours");
	expect(await hello()).toEqual({ due: false, acknowledgedAt: now });
	now += 23 * 60 * 60 * 1000;
	expect((await hello()).due).toBe(false);
	now += 2 * 60 * 60 * 1000;
	expect((await hello()).due).toBe(true);

	// 3. Open through the key path: one staged Proposal, valid for 15 minutes.
	const opened = await invoke([
		"open",
		"BTC",
		"--long",
		"hl:BTC",
		"--short",
		"lighter:BTC",
		"--size",
		"1000",
	]);
	expect(opened.code).toBe(0);
	expect(opened.out).toContain("Next: mob submit p-1");
	const store = new ProposalStore(home, () => now);
	const p1 = await store.get("p-1");
	expect(p1.kind).toBe("api-submit");
	expect(p1.expiresAt - p1.createdAt).toBe(900_000);
	expect(
		JSON.parse(
			await readFile(join(home, "proposals/p-1.request.json"), "utf8"),
		),
	).toEqual({
		command: "open",
		args: ["BTC"],
		values: { long: "hl:BTC", short: "lighter:BTC", size: "1000" },
	});

	// 4. The human took too long: submit restages the same intent and stops.
	now += 900_000;
	expect((await store.get("p-1")).status).toBe("expired");
	const restaged = await invoke(["submit", "p-1"]);
	expect(restaged.code).toBe(0);
	expect(restaged.out).toContain(
		"p-1 expired; staged p-2 with the same intent. Name p-2 to authorize: mob submit p-2.",
	);
	const p2 = await store.get("p-2");
	expect(p2.status).toBe("awaiting-submission");
	expect(p2.submit.body).toEqual(p1.submit.body);
	expect(p2.submit.idempotencyKey).not.toBe(p1.submit.idempotencyKey);
	expect((await store.get("p-1")).status).toBe("expired");
	// Nothing was sent for p-1 or p-2 yet.
	expect(
		calls.filter(
			(call) =>
				call.endsWith("/v1/delta-neutral/tasks") && call.startsWith("POST"),
		),
	).toHaveLength(0);

	// 5. Consent for the new id submits exactly once.
	const submitted = await invoke(["submit", "p-2"]);
	expect(submitted.code).toBe(0);
	expect(submitted.out).toContain("accepted, not executed");
	expect((await store.get("p-2")).status).toBe("submitted");
	expect(
		calls.filter(
			(call) =>
				call.endsWith("/v1/delta-neutral/tasks") && call.startsWith("POST"),
		),
	).toHaveLength(1);
	expect((await invoke(["submit", "p-2"])).code).toBe(1);

	// 6. An explicit restage of a live Proposal is refused; of an expired one works.
	expect((await invoke(["restage", "p-2"])).err).toContain(
		"only an expired Proposal can be restaged",
	);
	const another = await invoke([
		"open",
		"BTC",
		"--long",
		"hl:BTC",
		"--short",
		"lighter:BTC",
		"--size",
		"500",
	]);
	expect(another.out).toContain("Next: mob submit p-3");
	now += 900_000;
	const explicit = await invoke(["restage", "p-3"]);
	expect(explicit.code).toBe(0);
	expect(explicit.out).toContain(
		"p-3 expired; staged p-4 with the same intent.",
	);
	expect((await store.get("p-4")).submit.body).toMatchObject({ sizeUsd: 500 });
});
