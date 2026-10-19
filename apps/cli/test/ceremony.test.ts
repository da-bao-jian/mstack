import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CeremonyStore, ProposalStore } from "@mstack/proposals";
import { importKeystore } from "@mstack/signers";
import {
	fakeOwnerKey,
	fakeStrategyApi,
	loopbackFetch,
} from "../../../packages/mobius-api/test/fake-api.ts";
import { setConfig } from "../src/config.ts";
import { cliKeyStore } from "../src/key-store.ts";
import { type Runtime, run } from "../src/run.ts";
import { venueAccountResponse } from "./fixtures/venue-accounts.ts";

const homes: string[] = [];
const servers: { stop(): void }[] = [];
afterEach(async () => {
	for (const server of servers.splice(0)) server.stop();
	await Promise.all(
		homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
	);
});

test("bind --all stages one ceremony and keystore signs the batch with one unlock", async () => {
	const now = 1_800_000_000_000;
	const api = fakeStrategyApi({ now: () => now });
	servers.push(api);
	const home = await mkdtemp(join(tmpdir(), "mstack-cli-ceremony-"));
	homes.push(home);
	const password = "correct horse battery staple";
	const creation = [fakeOwnerKey, password, password];
	const address = await importKeystore(
		home,
		async () => creation.shift() ?? "",
	);
	expect(address).toBe(api.owner.address);
	for (const [key, value] of [
		["owner", api.owner.address],
		["signer", "keystore"],
		["policy", "manual"],
		["api_base", "https://funding.example.test"],
		["strategy_api_base", api.base],
	] as const)
		await setConfig(key, value, home);
	const out: string[] = [];
	const err: string[] = [];
	let unlocks = 0;
	const rt: Partial<Runtime> = {
		home,
		now: () => now,
		fetch: async (input, init) =>
			venueAccountResponse(input, init, api.owner.address) ??
			loopbackFetch(input, init),
		sleep: async () => {},
		out: (line) => out.push(line),
		err: (line) => err.push(line),
		readSecret: async () => {
			unlocks++;
			return password;
		},
	};
	expect(await run(["bind", "--all", "--venues", "hl,lighter"], rt)).toBe(0);
	expect(out.join("\n")).toContain(
		"c-1 · venue binding ceremony · hl, lighter",
	);
	expect(out.join("\n")).toContain("Next: mob sign c-1");
	out.length = 0;
	expect(await run(["proposals"], rt)).toBe(0);
	expect(out.join("\n")).toMatch(
		/c-1\tceremony\tawaiting-prepare-signature\texpires in \d+:\d{2}\thl, lighter/,
	);
	out.length = 0;
	const signCode = await run(["sign", "c-1"], rt);
	expect({ signCode, error: err.join("\n") }).toEqual({
		signCode: 0,
		error: "",
	});
	expect(unlocks).toBe(1);
	const stored = await new CeremonyStore(home, () => now).get("c-1");
	expect(stored.status).toBe("complete");
	expect(stored.requests).toHaveLength(4);
	expect(stored.requests.every((step) => step.status === "signed")).toBe(true);
	expect(stored.signatures).toHaveLength(4);
	expect(stored.read?.status).toBe("signed");
	expect(stored.latest?.results.map((result) => result.status)).toEqual([
		"bound",
		"bound",
	]);
	expect(out.join("\n")).toContain("c-1 complete · 2 venues bound");
	expect(err.join("\n")).not.toContain(fakeOwnerKey);
}, 30_000);

test("sign guard accepts c-N only when the latest user message names it", async () => {
	const transcript = await mkdtemp(join(tmpdir(), "mstack-guard-"));
	homes.push(transcript);
	const path = join(transcript, "transcript.jsonl");
	await Bun.write(
		path,
		`${JSON.stringify({ type: "user", message: { role: "user", content: "sign c-7" } })}\n`,
	);
	const errors: string[] = [];
	await setConfig("policy", "manual", transcript);
	const input = JSON.stringify({
		tool_input: { command: "mob sign c-7" },
		transcript_path: path,
	});
	const { signGuard } = await import("../src/sign-guard.ts");
	expect(await signGuard(input, (line) => errors.push(line), transcript)).toBe(
		0,
	);
	expect(
		await signGuard(
			JSON.stringify({
				tool_input: { command: "mob submit c-7" },
				transcript_path: path,
			}),
			(line) => errors.push(line),
			transcript,
		),
	).toBe(2);
	await Bun.write(
		path,
		`${JSON.stringify({ type: "user", message: { role: "user", content: "sign something" } })}\n`,
	);
	expect(await signGuard(input, (line) => errors.push(line), transcript)).toBe(
		2,
	);
	expect(errors.at(-1)).toContain("c-7");
});

const fakeApiKey = `mobius_01234567-89ab-cdef-0123-456789abcdef.${"ab".repeat(32)}`;

async function nativeHome(api: ReturnType<typeof fakeStrategyApi>) {
	const home = await mkdtemp(join(tmpdir(), "mstack-native-onboard-"));
	homes.push(home);
	const password = "native ceremony password";
	const creation = [fakeOwnerKey, password, password];
	await importKeystore(home, async () => creation.shift() ?? "");
	for (const [key, value] of [
		["signer", "keystore"],
		["policy", "manual"],
		["key_store", "file"],
		["api_base", "https://funding.example.test"],
		["strategy_api_base", api.base],
		["auth_base", "https://auth.example.test"],
	] as const)
		await setConfig(key, value, home);
	return { home, password };
}

function nativeFetch(
	api: ReturnType<typeof fakeStrategyApi>,
	options: { legalAccepted: boolean; calls: string[] },
): Runtime["fetch"] {
	return async (input, init) => {
		const url = new URL(String(input));
		const method = init?.method ?? "GET";
		options.calls.push(`${method} ${url.host}${url.pathname}`);
		const account = venueAccountResponse(input, init, api.owner.address);
		if (account) return account;
		if (url.pathname === "/legal/acceptance" && method !== "POST")
			return Response.json({
				accepted: options.legalAccepted,
				termsVersion: "2026-10-12",
				privacyVersion: "2026-10-12",
				acceptedAt: "2026-10-12T00:00:00.000Z",
			});
		if (url.pathname === "/legal/terms")
			return Response.json({
				termsVersion: "2026-10-12",
				termsUrl: "https://mob.exchange/terms",
				privacyVersion: "2026-10-12",
				privacyUrl: "https://mob.exchange/privacy",
			});
		if (url.pathname === "/legal/acceptance" && method === "POST") {
			const body = JSON.parse(String(init?.body));
			if (typeof body.signature !== "string" || !body.wallet)
				return Response.json({ error: "missing signature" }, { status: 400 });
			options.legalAccepted = true;
			return Response.json({ ok: true });
		}
		if (url.pathname === "/api/binding/readiness")
			return Response.json({
				ready: api.bound.has("hl") && api.bound.has("lighter"),
				venues: ["hl", "lighter"].map((venue) => ({
					venue,
					ready: api.bound.has(venue as "hl" | "lighter"),
					bound: api.bound.has(venue as "hl" | "lighter"),
				})),
			});
		if (url.pathname === "/api/keys/create" && method === "POST") {
			const body = JSON.parse(String(init?.body));
			if (typeof body.signature !== "string" || !body.nonce)
				return Response.json({ error: "missing signature" }, { status: 400 });
			return Response.json({
				key: fakeApiKey,
				record: {
					id: "01234567-89ab-cdef-0123-456789abcdef",
					name: body.name,
					venues: body.venues,
					max_size_usd: String(body.maxSizeUsd),
					key_prefix: "mobius_01234567-89ab-cdef-0123-456789abcdef…",
					created_at: "2030-01-01T00:00:00Z",
					revoked_at: null,
				},
			});
		}
		return loopbackFetch(input, init);
	};
}

test("a fresh user with no saved signer is told to name one, then --with signs", async () => {
	const now = 1_800_000_000_000;
	const api = fakeStrategyApi({ now: () => now });
	servers.push(api);
	const { home, password } = await nativeHome(api);
	const path = join(home, "config.json");
	const { signer: _, ...config } = JSON.parse(await readFile(path, "utf8"));
	await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, {
		mode: 0o600,
	});
	const lines: string[] = [];
	const rt: Partial<Runtime> = {
		home,
		now: () => now,
		fetch: nativeFetch(api, { legalAccepted: true, calls: [] }),
		sleep: async () => {},
		stdinIsTTY: false,
		stdoutIsTTY: false,
		out: (line) => lines.push(line),
		err: (line) => lines.push(line),
		readSecret: async () => password,
	};
	const args = ["--owner", api.owner.address, "--venues", "hl,lighter"];
	expect(await run(["onboard", "--native", ...args], rt)).toBe(0);
	expect(await run(["sign", "c-1"], rt)).toBe(1);
	expect(lines.join("\n")).toContain(
		"No signer is saved. Name one for this signature: mob sign c-1 --with browser",
	);
	expect(await run(["sign", "c-1", "--with", "keystore"], rt)).toBe(0);
	expect(lines.join("\n")).toContain("Ready · 2 venues bound");
});

test("native onboard binds, creates the key, and stores it in one wallet session", async () => {
	const now = 1_800_000_000_000;
	const api = fakeStrategyApi({ now: () => now });
	servers.push(api);
	const { home, password } = await nativeHome(api);
	const lines: string[] = [];
	const calls: string[] = [];
	const rt: Partial<Runtime> = {
		home,
		now: () => now,
		fetch: nativeFetch(api, { legalAccepted: true, calls }),
		sleep: async () => {},
		stdinIsTTY: false,
		stdoutIsTTY: false,
		out: (line) => lines.push(line),
		err: (line) => lines.push(line),
		readSecret: async () => password,
	};
	expect(
		await run(
			[
				"onboard",
				"--native",
				"--owner",
				api.owner.address,
				"--venues",
				"hl,lighter",
			],
			rt,
		),
	).toBe(0);
	expect(lines.join("\n")).toContain("c-1 · onboarding ceremony · hl, lighter");
	expect(lines.join("\n")).toContain(
		"One wallet session: bind hl, lighter, then create key “mstack” (cap $5,000) and store it locally.",
	);
	expect(lines.join("\n")).toContain("Next: mob sign c-1");
	expect(await run(["sign", "c-1"], rt)).toBe(0);
	const text = lines.join("\n");
	expect(text).toContain(
		"Key mobius_01234567-89ab-cdef-0123-456789abcdef… stored in file.",
	);
	expect(text).toContain(
		"Ready · 2 venues bound · key mobius_01234567-89ab-cdef-0123-456789abcdef… · cap $5,000",
	);
	expect(text).not.toContain(fakeApiKey);
	const ceremony = await new CeremonyStore(home, () => now).get("c-1");
	expect(ceremony.status).toBe("complete");
	expect(ceremony.key?.status).toBe("signed");
	// The signed prepare payload names the wallet's main Lighter account.
	expect(ceremony.venues).toEqual([
		{ venue: "hl", signatureChainId: 42161 },
		{ venue: "lighter", accountIndex: 123 },
	]);
	expect(ceremony.keyResult).toEqual({
		prefix: "mobius_01234567-89ab-cdef-0123-456789abcdef…",
		backend: "file",
	});
	expect(await new ProposalStore(home, () => now).list()).toHaveLength(0);
	const stored = await (await cliKeyStore({ home } as Runtime)).get(
		api.owner.address,
	);
	expect(stored?.meta).toMatchObject({
		name: "mstack",
		venues: ["hl", "lighter"],
		maxSizeUsd: 5000,
	});
	expect(
		calls.filter((call) => call.endsWith("/api/keys/create")),
	).toHaveLength(1);
	expect(
		calls.some(
			(call) => call.startsWith("POST") && call.endsWith("/legal/acceptance"),
		),
	).toBe(false);
});

test("native onboard signs the legal terms first when they are not accepted", async () => {
	const now = 1_800_000_000_000;
	const api = fakeStrategyApi({ now: () => now });
	servers.push(api);
	const { home, password } = await nativeHome(api);
	const lines: string[] = [];
	const calls: string[] = [];
	const rt: Partial<Runtime> = {
		home,
		now: () => now,
		fetch: nativeFetch(api, { legalAccepted: false, calls }),
		sleep: async () => {},
		stdinIsTTY: false,
		stdoutIsTTY: false,
		out: (line) => lines.push(line),
		err: (line) => lines.push(line),
		readSecret: async () => password,
	};
	expect(
		await run(
			[
				"onboard",
				"--native",
				"--owner",
				api.owner.address,
				"--venues",
				"hl,lighter",
				"--name",
				"desk",
				"--max-size",
				"2500",
			],
			rt,
		),
	).toBe(0);
	expect(lines.join("\n")).toContain(
		"One wallet session: accept legal terms, then bind hl, lighter, then create key “desk” (cap $2,500) and store it locally.",
	);
	const staged = await new CeremonyStore(home, () => now).get("c-1");
	expect(staged.legal?.id).toBe("c-1:legal");
	expect(staged.legal?.signing.type).toBe("typed");
	lines.length = 0;
	expect(await run(["proposal", "show", "c-1"], rt)).toBe(0);
	const shown = lines.join("\n");
	expect(shown).toContain("c-1 · ceremony · awaiting-prepare-signature");
	expect(shown).toContain("Key      “desk” · cap $2,500");
	expect(shown).toContain("1. · Accept MoB legal terms");
	expect(shown).toContain("2. · Authorize venue binding preparation");
	expect(shown).toContain("· Create API key “desk” and store it locally");
	expect(shown).toContain("Next: mob sign c-1");
	lines.length = 0;
	expect(await run(["proposal", "show", "c-1", "--json"], rt)).toBe(0);
	expect(JSON.parse(lines.join("\n"))).toMatchObject({
		id: "c-1",
		kind: "ceremony",
		keyPlan: { name: "desk", maxSizeUsd: 2500 },
		steps: [
			{ id: "c-1:legal", status: "awaiting-signature" },
			{ id: "c-1:prepare" },
		],
	});
	expect(await run(["sign", "c-1"], rt)).toBe(0);
	const text = lines.join("\n");
	expect(text).toContain("c-1:legal · step 1 of");
	expect(text).toContain("Legal terms accepted.");
	expect(text).toContain(
		"Ready · 2 venues bound · key mobius_01234567-89ab-cdef-0123-456789abcdef… · cap $2,500",
	);
	const legalPost = calls.findIndex(
		(call) => call === "POST auth.example.test/legal/acceptance",
	);
	const prepare = calls.findIndex((call) =>
		call.endsWith("/v1/venue-bindings/prepare"),
	);
	expect(legalPost).toBeGreaterThanOrEqual(0);
	expect(legalPost).toBeLessThan(prepare);
	const ceremony = await new CeremonyStore(home, () => now).get("c-1");
	expect(ceremony.legal?.status).toBe("signed");
	expect(ceremony.status).toBe("complete");
	expect(
		await (await cliKeyStore({ home } as Runtime)).get(api.owner.address),
	).toMatchObject({
		meta: { name: "desk", venues: ["hl", "lighter"], maxSizeUsd: 2500 },
	});
});
