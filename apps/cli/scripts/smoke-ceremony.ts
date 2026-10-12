import assert from "node:assert/strict";
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
import { fakePositionServer } from "../test/fixtures/fake-funding-server.ts";

const now = 1_800_000_000_000;
const api = fakeStrategyApi({ now: () => now });
const home = await mkdtemp(join(tmpdir(), "mstack-smoke-ceremony-"));
const password = "smoke ceremony password";
const output: string[] = [];

async function compiled(args: string[], binaryHome: string) {
	const binary = join(import.meta.dir, "../dist/mob");
	const child = Bun.spawn([binary, ...args], {
		env: { ...process.env, MOB_HOME: binaryHome, MOB_NO_OPEN: "1" },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	output.push(`$ mob ${args.join(" ")}`, stdout.trim(), stderr.trim());
	assert.equal(exitCode, 0, stderr || stdout);
	return `${stdout}${stderr}`;
}

try {
	const realHome = await mkdtemp(
		join(tmpdir(), "mstack-smoke-ceremony-clock-"),
	);
	const realApi = fakeStrategyApi();
	const realFunding = fakePositionServer(realApi.owner.address);
	realFunding.readinessUnbound.add("aster");
	try {
		await compiled(["config", "set", "owner", realApi.owner.address], realHome);
		await compiled(["config", "set", "policy", "manual"], realHome);
		await compiled(["config", "set", "api_base", realFunding.base], realHome);
		await compiled(
			["config", "set", "strategy_api_base", realApi.base],
			realHome,
		);
		const before = Math.floor(Date.now() / 1000);
		const staged = await compiled(
			["bind", "--all", "--venues", "aster"],
			realHome,
		);
		assert.match(staged, /c-1 · venue binding ceremony · aster/);
		assert.match(await compiled(["proposals"], realHome), /c-1/);
		const ceremony = await new CeremonyStore(realHome).get("c-1");
		assert.equal(ceremony.prepare.signing.type, "text");
		if (ceremony.prepare.signing.type !== "text")
			throw new Error("prepare must use text signing");
		const payload = JSON.parse(
			ceremony.prepare.signing.message.split("payload=")[1],
		) as { expiresAt: number };
		const after = Math.floor(Date.now() / 1000);
		assert.ok(Number.isSafeInteger(payload.expiresAt));
		assert.ok(payload.expiresAt >= before);
		assert.ok(payload.expiresAt <= after + 300);
		output.push(
			`real-clock prepare expiresAt=${payload.expiresAt}; now=${after}; delta=${payload.expiresAt - after}s`,
		);
		assert.deepEqual(realFunding.errors, []);
	} finally {
		realFunding.stop();
		realApi.stop();
		await rm(realHome, { recursive: true, force: true });
	}

	const inputs = [fakeOwnerKey, password, password];
	await importKeystore(home, async () => inputs.shift() ?? "");
	for (const [key, value] of [
		["signer", "keystore"],
		["policy", "manual"],
		["api_base", "https://funding.example.test"],
		["strategy_api_base", api.base],
		["auth_base", api.base],
	] as const)
		await setConfig(key, value, home);
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
					bound: api.bound.has(venue as "hl" | "lighter"),
					ready: api.bound.has(venue as "hl" | "lighter"),
				})),
			});
		return loopbackFetch(input, init);
	};
	const runtime: Partial<Runtime> = {
		home,
		fetch,
		now: () => now,
		sleep: async () => {},
		stdinIsTTY: false,
		stdoutIsTTY: false,
		readSecret: async () => password,
		out: (line) => output.push(line),
		err: (line) => output.push(line),
	};
	assert.equal(
		await run(
			[
				"onboard",
				"--native",
				"--owner",
				api.owner.address,
				"--venues",
				"hl,lighter",
			],
			runtime,
		),
		0,
	);
	assert.equal(await run(["sign", "c-1"], runtime), 0);
	assert.equal(
		(await new CeremonyStore(home, () => now).get("c-1")).status,
		"complete",
	);
	const proposals = await new ProposalStore(home, () => now).list();
	assert.equal(proposals.length, 1);
	assert.equal(proposals[0].submit.route, "/api/keys/create");
	console.log(output.join("\n"));
} finally {
	api.stop();
	await rm(home, { recursive: true, force: true });
}
