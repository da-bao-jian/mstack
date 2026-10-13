import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { ProposalStore } from "@mstack/proposals";
import { metadataContext } from "../../../packages/funding/test/metadata-fixtures.ts";
import {
	fakeStrategyApi,
	loopbackFetch as strategyFetch,
} from "../../../packages/mobius-api/test/fake-api.ts";
import pkg from "../package.json";
import { setConfig } from "../src/config.ts";
import { type Runtime, run } from "../src/run.ts";
import {
	fakePositionServer,
	loopbackFetch as fundingFetch,
} from "../test/fixtures/fake-funding-server.ts";

const home = await mkdtemp(join(tmpdir(), "mstack-journey-e-"));
const now = Date.now();
const strategy = fakeStrategyApi();
const funding = fakePositionServer(strategy.owner.address, () => now);
const metadata = await metadataContext();
const authErrors: Error[] = [];
const auth = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch(req) {
		try {
			const url = new URL(req.url);
			assert.equal(url.pathname, "/legal/acceptance");
			assert.equal(url.searchParams.get("wallet"), strategy.owner.address);
			assert.equal(req.headers.get("X-Mobius-Client"), `mstack/${pkg.version}`);
			return Response.json({
				accepted: true,
				termsVersion: "2026-10-12",
				privacyVersion: "2026-10-12",
				acceptedAt: "2026-10-12T00:00:00.000Z",
			});
		} catch (error) {
			authErrors.push(error as Error);
			return Response.json({ error: String(error) }, { status: 400 });
		}
	},
});
const authBase = `http://127.0.0.1:${auth.port}`;
const output: string[] = [];
const fetch = async (input: string | URL | Request, init?: RequestInit) => {
	const url = String(input);
	if (url.startsWith(strategy.base)) return strategyFetch(url, init);
	if (url.startsWith(funding.base)) return fundingFetch(url, init);
	if (url.startsWith(authBase)) return globalThis.fetch(url, init);
	return metadata.fetch(url, init);
};

async function command(
	args: string[],
	overrides: Partial<Runtime> = {},
): Promise<string> {
	const lines: string[] = [];
	const code = await run(args, {
		home,
		now: () => now,
		fetch,
		env: { ...process.env, MOB_NO_OPEN: "1" },
		stdinIsTTY: false,
		stdoutIsTTY: false,
		out: (line) => lines.push(line),
		err: (line) => lines.push(line),
		...overrides,
	});
	assert.equal(code, 0, lines.join("\n"));
	const text = lines.join("\n");
	output.push(`$ mob ${args.join(" ")}`, text);
	return text;
}

try {
	await setConfig("key_store", "file", home);
	await setConfig("policy", "manual", home);
	await setConfig("api_base", funding.base, home);
	await setConfig("auth_base", authBase, home);
	await setConfig("strategy_api_base", strategy.base, home);

	const first = await command([
		"onboard",
		"--owner",
		strategy.owner.address,
		"--venues",
		"hl,lighter",
	]);
	assert.match(first, /^Open .*\?nav=api/m);
	assert.match(first, /Next: paste the key in the chat/);

	const imported = await command(
		[
			"keys",
			"import",
			"--stdin",
			"--name",
			"journey-e",
			"--venues",
			"hl,lighter",
			"--max-size",
			"5000",
		],
		{ readStdin: async () => strategy.key },
	);
	assert.match(imported, /Key mobius_[0-9a-f-]{36}… stored in file/);
	assert.ok(!imported.includes(strategy.key));

	const ready = await command(["onboard", "--venues", "hl,lighter"]);
	assert.match(
		ready,
		/Ready · 2 venues bound · key mobius_[0-9a-f-]{36}… · cap \$5,000/,
	);
	assert.match(ready, /<mob-home>\n[\s\S]*\n<\/mob-home>/);
	assert.ok(ready.split("\n").some((line) => /[#+-].*Ready/.test(line)));
	assert.doesNotMatch(ready, /^Key\s+.*not checked$/m);
	assert.doesNotMatch(ready, /^Legal\s+.*not checked$/m);

	const opened = await command([
		"open",
		"BTC",
		"--long",
		"hl:BTC",
		"--short",
		"lighter:BTC",
		"--size",
		"500",
	]);
	assert.match(opened, /Staged for API-key submission\. Next: mob submit p-1/);
	const proposal = await new ProposalStore(home, () => now).get("p-1");
	assert.equal(proposal.kind, "api-submit");
	assert.ok(!JSON.stringify(proposal).includes(strategy.key));

	const submitted = await command(["submit", "p-1"]);
	assert.match(submitted, /accepted, not executed/);
	const status = await command(["status"]);
	assert.match(
		status,
		new RegExp(`api: ${strategy.base.replaceAll("/", "\\/")}`),
	);

	for (const entry of await readdir(home, {
		recursive: true,
		withFileTypes: true,
	})) {
		if (!entry.isFile()) continue;
		const path = join(entry.parentPath, entry.name);
		const name = relative(home, path);
		const contents = await readFile(path, "utf8");
		if (contents.includes(strategy.key))
			assert.match(
				name,
				/^keys\//,
				`secret escaped the key store into ${name}`,
			);
	}
	assert.ok(!output.join("\n").includes(strategy.key));
	assert.deepEqual(funding.errors, []);
	assert.deepEqual(authErrors, []);
	console.log(output.join("\n"));
	console.log(
		"smoke:journey-e passed · onboard → stdin import → Ready → API open → submit → status · secret confined to key store",
	);
} finally {
	auth.stop(true);
	funding.stop();
	strategy.stop();
	await rm(home, { recursive: true, force: true });
}
