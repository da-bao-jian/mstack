import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeStrategyApi } from "../../../packages/mobius-api/test/fake-api.ts";
import pkg from "../package.json";
import { fakePositionServer } from "../test/fixtures/fake-funding-server.ts";

const root = await mkdtemp(join(tmpdir(), "mstack-smoke-onboard-"));
const home = join(root, "home");
const noOpenHome = join(root, "no-open-home");
const bin = join(root, "bin");
const openLog = join(root, "open.log");
const binary = join(import.meta.dir, "../dist/mob");
const strategy = fakeStrategyApi();
const owner = strategy.owner.address;
const funding = fakePositionServer(owner);
funding.readinessUnbound.add("aster");
const authErrors: Error[] = [];
const auth = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch(req) {
		try {
			const url = new URL(req.url);
			assert.equal(req.headers.get("X-Mobius-Client"), `mstack/${pkg.version}`);
			assert.equal(req.headers.get("User-Agent"), `mstack/${pkg.version}`);
			assert.equal(url.pathname, "/legal/acceptance");
			assert.equal(url.searchParams.get("wallet"), owner);
			return Response.json({
				accepted: true,
				termsVersion: "2026-10-12",
				privacyVersion: "2026-10-12",
				acceptedAt: "2026-10-12T00:00:00.000Z",
			});
		} catch (error) {
			authErrors.push(error as Error);
			return Response.json(
				{ error: (error as Error).message },
				{ status: 400 },
			);
		}
	},
});
const output: string[] = [];
const baseEnv = {
	...process.env,
	PATH: `${bin}:${process.env.PATH ?? ""}`,
	MOB_OPEN_LOG: openLog,
};

async function command(
	args: string[],
	options: { commandHome?: string; noOpen?: boolean; stdin?: string } = {},
) {
	const child = Bun.spawn([binary, ...args], {
		env: {
			...baseEnv,
			MOB_HOME: options.commandHome ?? home,
			MOB_NO_OPEN: options.noOpen ? "1" : "0",
		},
		stdin: options.stdin === undefined ? "ignore" : "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	if (options.stdin !== undefined) {
		if (!child.stdin) throw new Error("Compiled command stdin is unavailable");
		child.stdin.write(options.stdin);
		child.stdin.end();
	}
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	output.push(`$ mob ${args.join(" ")}`, stdout.trim(), stderr.trim());
	assert.equal(exitCode, 0, stderr || stdout);
	return `${stdout}${stderr}`;
}

async function configure(commandHome: string) {
	await command(["config", "set", "key_store", "file"], { commandHome });
	await command(["config", "set", "api_base", funding.base], { commandHome });
	await command(
		["config", "set", "auth_base", `http://127.0.0.1:${auth.port}`],
		{
			commandHome,
		},
	);
	await command(["config", "set", "strategy_api_base", strategy.base], {
		commandHome,
	});
}

async function openCalls() {
	try {
		return (await readFile(openLog, "utf8")).trim().split("\n").filter(Boolean);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

try {
	await mkdir(bin, { recursive: true });
	await Bun.write(
		join(bin, "open"),
		'#!/bin/sh\nprintf "%s\\n" "$1" >> "$MOB_OPEN_LOG"\n',
	);
	await chmod(join(bin, "open"), 0o755);
	await configure(home);
	const first = await command([
		"onboard",
		"--owner",
		owner,
		"--venues",
		"hl,lighter",
	]);
	assert.match(first, /Next: paste the key in the chat/);
	assert.equal((await openCalls()).length, 1);
	const second = await command(["onboard", "--venues", "hl,lighter"]);
	assert.match(second, /Next: paste the key in the chat/);
	assert.equal((await openCalls()).length, 1);

	await configure(noOpenHome);
	const suppressed = await command(
		["onboard", "--owner", owner, "--venues", "hl,lighter"],
		{ commandHome: noOpenHome, noOpen: true },
	);
	assert.match(suppressed, /Next: paste the key in the chat/);
	assert.equal((await openCalls()).length, 1);

	await command(
		[
			"keys",
			"import",
			"--stdin",
			"--venues",
			"hl,lighter",
			"--max-size",
			"5000",
		],
		{ stdin: strategy.key },
	);
	const ready = await command(["onboard", "--venues", "hl,lighter"]);
	assert.match(
		ready,
		/Ready · 2 venues bound · key mobius_[0-9a-f-]{36}… · cap \$5,000/,
	);
	assert.ok(!output.join("\n").includes(strategy.key));
	const staged = await command(["bind", "--all", "--venues", "aster"]);
	assert.match(staged, /c-1 · venue binding ceremony · aster/);
	assert.match(await command(["proposals"]), /c-1\tceremony/);
	assert.equal((await openCalls()).length, 1);
	assert.deepEqual(funding.errors, []);
	assert.deepEqual(authErrors, []);
	console.log(output.filter(Boolean).join("\n"));
	console.log("open calls: 1; second onboard: 0 additional; MOB_NO_OPEN: 0");
} finally {
	auth.stop(true);
	funding.stop();
	strategy.stop();
	await rm(root, { recursive: true, force: true });
}
