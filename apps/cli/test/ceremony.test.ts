import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
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
import { type Runtime, run } from "../src/run.ts";

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
		fetch: loopbackFetch,
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

test("native onboard stages the key Proposal after the batch binds", async () => {
	const now = 1_800_000_000_000;
	const api = fakeStrategyApi({ now: () => now });
	servers.push(api);
	const home = await mkdtemp(join(tmpdir(), "mstack-native-onboard-"));
	homes.push(home);
	const password = "native ceremony password";
	const creation = [fakeOwnerKey, password, password];
	await importKeystore(home, async () => creation.shift() ?? "");
	for (const [key, value] of [
		["signer", "keystore"],
		["policy", "manual"],
		["api_base", "https://funding.example.test"],
		["strategy_api_base", api.base],
		["auth_base", api.base],
	] as const)
		await setConfig(key, value, home);
	const lines: string[] = [];
	const fetch: Runtime["fetch"] = async (input, init) => {
		const url = new URL(String(input));
		if (url.pathname === "/legal/acceptance")
			return Response.json({
				accepted: true,
				termsVersion: "2026-10-12",
				privacyVersion: "2026-10-12",
				acceptedAt: "2026-10-12T00:00:00.000Z",
			});
		if (url.pathname === "/api/binding/readiness")
			return Response.json({
				ready: api.bound.has("hl") && api.bound.has("lighter"),
				venues: ["hl", "lighter"].map((venue) => ({
					venue,
					ready: api.bound.has(venue as "hl" | "lighter"),
					bound: api.bound.has(venue as "hl" | "lighter"),
				})),
			});
		return loopbackFetch(input, init);
	};
	const rt: Partial<Runtime> = {
		home,
		now: () => now,
		fetch,
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
	expect(lines.join("\n")).toContain("Next: mob sign c-1");
	expect(await run(["sign", "c-1"], rt)).toBe(0);
	const proposals = await new ProposalStore(home, () => now).list();
	expect(proposals).toHaveLength(1);
	expect(proposals[0].submit.route).toBe("/api/keys/create");
	expect(proposals[0].submit.body).toMatchObject({
		name: "mstack",
		venues: ["hl", "lighter"],
		maxSizeUsd: 5000,
	});
});
