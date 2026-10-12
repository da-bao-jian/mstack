import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apiKeyMessage } from "@mstack/mobius-client";
import { ProposalStore } from "@mstack/proposals";
import { privateKeyToAccount } from "viem/accounts";
import { fakeBrowserWallet } from "../../../packages/signers/test/fake-browser-wallet.ts";
import { setConfig } from "../src/config.ts";
import { keyListTable } from "../src/keys-command.ts";
import { type Runtime, run } from "../src/run.ts";

const owner = "0x0000000000000000000000000000000000000001";
const key = `mobius_01234567-89ab-cdef-0123-456789abcdef.${"ab".repeat(32)}`;
const now = 1_800_000_000_000;
const homes: string[] = [];
afterEach(async () => {
	await Promise.all(
		homes.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function setup(extra: { signer?: string } = {}) {
	const home = await mkdtemp(join(tmpdir(), "mstack-cli-keys-"));
	homes.push(home);
	await setConfig("owner", owner, home);
	await setConfig("key_store", "file", home);
	await setConfig("api_base", "http://127.0.0.1:9988", home);
	if (extra.signer) await setConfig("signer", extra.signer, home);
	return home;
}

async function invoke(
	home: string,
	args: string[],
	overrides: Partial<Runtime> = {},
) {
	const out: string[] = [];
	const err: string[] = [];
	const code = await run(args, {
		home,
		now: () => now,
		out: (line) => out.push(line),
		err: (line) => err.push(line),
		fetch: async () =>
			Response.json({ tasks: [], nextCursor: null }, { status: 200 }),
		...overrides,
	});
	return { code, out: out.join("\n"), err: err.join("\n") };
}

test("keys import verifies, asks for metadata, and prints only prefix and backend", async () => {
	const home = await setup();
	const answers = ["desk", "hl,lighter", "5000"];
	const result = await invoke(home, ["keys", "import"], {
		readSecret: async () => key,
		prompt: async () => answers.shift() ?? "",
	});
	expect(result.code).toBe(0);
	expect(result.out).toContain("Key store: file");
	expect(result.out).toContain(
		"mobius_01234567-89ab-cdef-0123-456789abcdef… stored in file",
	);
	expect(result.out).not.toContain(key);
	const stored = JSON.parse(
		await readFile(join(home, "keys", `${owner}.json`), "utf8"),
	);
	expect(stored).toEqual({
		key,
		meta: {
			name: "desk",
			venues: ["hl", "lighter"],
			maxSizeUsd: 5000,
			importedAt: now,
			verifiedAt: now,
			apiBase: "http://127.0.0.1:9988",
		},
	});
});

test("keys import --stdin accepts agent metadata and leaks only into the key store", async () => {
	const home = await setup();
	let authorization = "";
	const result = await invoke(
		home,
		[
			"keys",
			"import",
			"--stdin",
			"--name",
			"chat key",
			"--venues",
			"hl",
			"--max-size",
			"5000",
		],
		{
			readStdin: async () => `${key}\n`,
			readSecret: async () => {
				throw new Error("hidden prompt must not run");
			},
			prompt: async () => {
				throw new Error("metadata prompt must not run");
			},
			fetch: async (_input, init) => {
				authorization = new Headers(init?.headers).get("authorization") ?? "";
				return Response.json({ tasks: [], nextCursor: null }, { status: 200 });
			},
		},
	);
	expect(result.code).toBe(0);
	expect(authorization).toBe(`Bearer ${key}`);
	expect(`${result.out}\n${result.err}`).not.toContain(key);
	expect(result.out).toContain(
		"mobius_01234567-89ab-cdef-0123-456789abcdef… stored in file",
	);
	const keyPath = `keys/${owner}.json`;
	const files: string[] = [];
	for await (const relative of new Bun.Glob("**/*").scan({
		cwd: home,
		onlyFiles: true,
	}))
		files.push(relative);
	expect(files).toContain(keyPath);
	for (const relative of files) {
		const contents = await readFile(join(home, relative), "utf8");
		if (relative === keyPath) expect(contents).toContain(key);
		else expect(contents).not.toContain(key);
	}
	expect(files.some((relative) => relative.startsWith("proposals/"))).toBe(
		false,
	);
	const stored = JSON.parse(await readFile(join(home, keyPath), "utf8"));
	expect(stored.meta).toMatchObject({
		name: "chat key",
		venues: ["hl"],
		maxSizeUsd: 5000,
	});
});

test("keys import refuses argv secrets, env-source flags, and multiline stdin", async () => {
	const home = await setup();
	const argv = await invoke(home, ["keys", "import", key]);
	expect(argv.code).toBe(1);
	expect(argv.err).toContain(
		"pass the key on stdin or type it at the prompt; never on the command line",
	);
	expect(`${argv.out}\n${argv.err}`).not.toContain(key);

	const fromEnv = await invoke(home, ["keys", "import", "--from-env"]);
	expect(fromEnv.code).toBe(1);
	expect(fromEnv.err).toContain(
		"MOBIUS_API_KEY is a read-only runtime override; --from-env is not supported",
	);

	const multiline = await invoke(home, ["keys", "import", "--stdin"], {
		readStdin: async () => `${key}\nsecond-line\n`,
	});
	expect(multiline.code).toBe(1);
	expect(multiline.err).toContain("stdin must contain exactly one key line");
	expect(`${multiline.out}\n${multiline.err}`).not.toContain(key);
});

test("keys import --stdin leaves omitted metadata unknown", async () => {
	const home = await setup();
	const result = await invoke(home, ["keys", "import", "--stdin"], {
		readStdin: async () => key,
	});
	expect(result.code).toBe(0);
	const stored = JSON.parse(
		await readFile(join(home, "keys", `${owner}.json`), "utf8"),
	);
	expect(stored.meta).not.toHaveProperty("name");
	expect(stored.meta).not.toHaveProperty("venues");
	expect(stored.meta).not.toHaveProperty("maxSizeUsd");
});

test("key_store config defaults to auto and validates backend names", async () => {
	const home = await mkdtemp(join(tmpdir(), "mstack-cli-key-config-"));
	homes.push(home);
	expect((await invoke(home, ["config", "get", "key_store"])).out).toBe("auto");
	expect(
		(await invoke(home, ["config", "set", "key_store", "secret-tool"])).out,
	).toBe("secret-tool");
	const invalid = await invoke(home, ["config", "set", "key_store", "memory"]);
	expect(invalid.code).toBe(1);
	expect(invalid.err).toContain(
		"expected auto | env | keychain | secret-tool | file",
	);
});

test("key messages match the W18 byte strings and list rendering uses public fields", () => {
	const timestamp = now / 1000;
	expect(apiKeyMessage("list", { owner, timestamp })).toBe(
		`Mobius API keys: list owner=${owner} timestamp=${timestamp}`,
	);
	expect(
		apiKeyMessage("revoke", {
			owner,
			id: "01234567-89ab-cdef-0123-456789abcdef",
			timestamp,
		}),
	).toBe(
		`Mobius API keys: revoke owner=${owner} id=01234567-89ab-cdef-0123-456789abcdef timestamp=${timestamp}`,
	);
	const rendered = keyListTable([
		{
			id: "01234567-89ab-cdef-0123-456789abcdef",
			name: "desk",
			venues: ["hl", "lighter"],
			max_size_usd: "5000",
			key_prefix: "mobius_01234567-89ab-cdef-0123-456789abcdef…",
			created_at: "2030-01-01T00:00:00Z",
			revoked_at: null,
		},
	]);
	expect(rendered).toContain("mobius_01234567-89ab-cdef-0123-456789abcdef…");
	expect(rendered).toContain("hl,lighter");
	expect(rendered).toContain("5000");
});

test("keys import refuses no TTY, 401, and network errors without an override", async () => {
	for (const [fetch, expected] of [
		[
			async () => new Response("no", { status: 401 }),
			"key rejected by the API, not stored",
		],
		[
			async () => {
				throw new Error("down");
			},
			"could not verify; not stored",
		],
	] as const) {
		const home = await setup();
		const result = await invoke(home, ["keys", "import"], {
			readSecret: async () => key,
			fetch,
		});
		expect(result.code).toBe(1);
		expect(result.err).toContain(expected);
		expect(await readdir(home)).not.toContain("keys");
	}
	const noTty = await invoke(await setup(), ["keys", "import"], {
		readSecret: async () => {
			throw new Error("A controlling TTY (/dev/tty) is required");
		},
	});
	expect(noTty.err).toContain("MOBIUS_API_KEY");
});

test("--unverified stores after a network failure and warns", async () => {
	const home = await setup();
	const result = await invoke(home, ["keys", "import", "--unverified"], {
		readSecret: async () => key,
		prompt: async () => "",
		fetch: async () => {
			throw new Error("down");
		},
	});
	expect(result.code).toBe(0);
	expect(result.out).toContain("Warning: storing an unverified API key");
	expect(result.out).not.toContain(key);
});

test("keys create checks binding readiness and stages exact key intent", async () => {
	const home = await setup({ signer: "browser" });
	let readinessUrl = "";
	const result = await invoke(
		home,
		[
			"keys",
			"create",
			"--name",
			"desk",
			"--venues",
			"hl,lighter",
			"--max-size",
			"5000",
		],
		{
			fetch: async (input) => {
				readinessUrl = String(input);
				return Response.json([
					{ venue: "hl", bound: true },
					{ venue: "lighter", bound: true },
				]);
			},
		},
	);
	expect(result.code).toBe(0);
	expect(readinessUrl).toContain("/api/binding/readiness?ownerAddress=");
	expect(result.out).toContain(
		"Create API key “desk” · venues hl, lighter · cap $5000",
	);
	expect(result.out).toContain(
		`Mobius API keys: create owner=${owner} name="desk" venues=hl,lighter maxSizeUsd=5000 nonce=`,
	);
	const proposal = await new ProposalStore(home, () => now).get("p-1");
	expect(proposal.submit.route).toBe("/api/keys/create");
	expect(proposal.submit.onAnswer).toBe("store-api-key");
	expect(proposal.submit.body).toMatchObject({
		owner,
		name: "desk",
		venues: ["hl", "lighter"],
		maxSizeUsd: 5000,
		timestamp: now / 1000,
	});
});

test("keys create refuses an unbound requested venue", async () => {
	const home = await setup({ signer: "browser" });
	const result = await invoke(
		home,
		[
			"keys",
			"create",
			"--name",
			"desk",
			"--venues",
			"hl,lighter",
			"--max-size",
			"5000",
		],
		{
			fetch: async () =>
				Response.json([
					{ venue: "hl", bound: true },
					{ venue: "lighter", bound: false },
				]),
		},
	);
	expect(result.code).toBe(1);
	expect(result.err).toContain("lighter is not bound");
	expect(await readdir(home)).not.toContain("proposals");
});

test("keys list and revoke stage read and revoke Proposals", async () => {
	const home = await setup({ signer: "browser" });
	const listed = await invoke(home, ["keys", "list"]);
	expect(listed.code).toBe(0);
	expect(listed.out).toContain("signature cannot create, revoke, or trade");
	const revoked = await invoke(home, [
		"keys",
		"revoke",
		"01234567-89ab-cdef-0123-456789abcdef",
	]);
	expect(revoked.code).toBe(0);
	expect(
		(await new ProposalStore(home, () => now).get("p-2")).submit.route,
	).toBe("/api/keys/revoke");
});

test("sign stores a create answer but persists and prints only its prefix", async () => {
	const wallet = privateKeyToAccount(`0x${"01".repeat(32)}`);
	const home = await mkdtemp(join(tmpdir(), "mstack-cli-key-sign-"));
	homes.push(home);
	await setConfig("owner", wallet.address, home);
	await setConfig("signer", "browser", home);
	await setConfig("key_store", "file", home);
	await setConfig("api_base", "http://127.0.0.1:9988", home);
	await invoke(
		home,
		[
			"keys",
			"create",
			"--name",
			"desk",
			"--venues",
			"hl,lighter",
			"--max-size",
			"5000",
		],
		{
			fetch: async () =>
				Response.json([
					{ venue: "hl", bound: true },
					{ venue: "lighter", bound: true },
				]),
		},
	);
	const wallets: Promise<void>[] = [];
	let clientHeader = "";
	const result = await invoke(home, ["sign", "p-1"], {
		openUrl: async (url) => {
			wallets.push(fakeBrowserWallet(url, wallet));
		},
		fetch: async (_input, init) => {
			clientHeader = new Headers(init?.headers).get("X-Mobius-Client") ?? "";
			return Response.json({
				key,
				record: {
					id: "01234567-89ab-cdef-0123-456789abcdef",
					name: "desk",
					venues: ["hl", "lighter"],
					max_size_usd: "5000",
					key_prefix: "mobius_01234567-89ab-cdef-0123-456789abcdef…",
					created_at: "2030-01-01T00:00:00Z",
					revoked_at: null,
				},
			});
		},
	});
	await Promise.all(wallets);
	expect(result.code).toBe(0);
	expect(clientHeader).toBe("mstack/0.3.0");
	expect(`${result.out}\n${result.err}`).not.toContain(key);
	expect(result.out).toContain("stored in file");
	const proposalBytes = await readFile(
		join(home, "proposals", "p-1.json"),
		"utf8",
	);
	expect(proposalBytes).not.toContain(key);
	expect(proposalBytes).toContain(
		"mobius_01234567-89ab-cdef-0123-456789abcdef…",
	);
	expect(
		await readFile(
			join(home, "keys", `${wallet.address.toLowerCase()}.json`),
			"utf8",
		),
	).toContain(key);
});

test("show JSON and delete never reveal the secret", async () => {
	const home = await setup();
	await invoke(home, ["keys", "import"], {
		readSecret: async () => key,
		prompt: async () => "",
	});
	const shown = await invoke(home, ["keys", "show", "--json"]);
	expect(shown.code).toBe(0);
	expect(shown.out).not.toContain(key);
	expect(JSON.parse(shown.out).prefix).toContain("…");
	const homeScreen = await invoke(home, ["hello", "--plain"]);
	expect(homeScreen.out).toContain(
		"Key       mobius_01234567-89ab-cdef-0123-456789abcdef… (file) · ok",
	);
	const doctor = await invoke(home, ["doctor", "--json"]);
	expect(
		JSON.parse(doctor.out).checks.find(
			(check: { name: string }) => check.name === "Key",
		),
	).toMatchObject({ status: "pass", critical: false });
	const removed = await invoke(home, ["keys", "delete"]);
	expect(removed.out).toContain("still works until it is revoked");
});
