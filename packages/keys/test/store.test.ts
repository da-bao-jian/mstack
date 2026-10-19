import { afterEach, expect, test } from "bun:test";
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createKeyStore,
	type KeyMeta,
	type KeyStoreBackend,
} from "../src/index.ts";

const owner = "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD";
const key = `mobius_01234567-89ab-cdef-0123-456789abcdef.${"ab".repeat(32)}`;
const meta: KeyMeta = {
	name: "desk",
	venues: ["hl", "lighter"],
	maxSizeUsd: 5000,
	importedAt: 1_800_000_000_000,
	verifiedAt: 1_800_000_000_123,
	apiBase: "https://api.mob.exchange",
};
const homes: string[] = [];
afterEach(async () => {
	await Promise.all(
		homes.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function home() {
	const path = await mkdtemp(join(tmpdir(), "mstack-keys-"));
	homes.push(path);
	return path;
}

type RunResult = { code: number; stdout: string; stderr: string };
type FakeRun = (argv: string[], stdin?: string) => Promise<RunResult>;
const ok: RunResult = { code: 0, stdout: "", stderr: "" };

/** One `security -i` line: double-quoted words with backslash escapes. */
function securityWords(line: string): string[] {
	return [...line.trim().matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)].map(
		(match) => match[1]?.replace(/\\(.)/g, "$1") ?? match[2],
	);
}

/** A fake OS credential store shared by every home, keyed like the real one
 * and failing with the real exit codes: `security` 44 for a missing item,
 * `secret-tool lookup` 1 with no output. */
function fakeStore(failure?: (argv: string[]) => RunResult | undefined) {
	const items = new Map<string, string>();
	const calls: { argv: string[]; stdin?: string }[] = [];
	const after = (argv: string[], flag: string) =>
		argv[argv.indexOf(flag) + 1] ?? "";
	const id = (argv: string[]) =>
		argv.includes("-s")
			? `${after(argv, "-s")}|${after(argv, "-a")}`
			: `${after(argv, "service")}|${after(argv, "owner")}`;
	const run: FakeRun = async (argv, stdin) => {
		calls.push({ argv, stdin });
		const failed = failure?.(argv);
		if (failed) return failed;
		if (argv[1] === "-i") {
			const words = securityWords(stdin ?? "");
			if (words[0] !== "add-generic-password")
				return { code: 0, stdout: "", stderr: "unknown command" };
			items.set(id(words), after(words, "-w"));
			return ok;
		}
		if (argv[1] === "store") {
			items.set(id(argv), stdin?.trimEnd() ?? "");
			return ok;
		}
		const secret = items.get(id(argv));
		if (secret === undefined)
			return argv.includes("-s")
				? {
						code: 44,
						stdout: "",
						stderr:
							"security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.",
					}
				: { code: 1, stdout: "", stderr: "" };
		if (argv[1] === "delete-generic-password" || argv[1] === "clear") {
			items.delete(id(argv));
			return ok;
		}
		if (argv[1] === "find-generic-password" && !argv.includes("-w"))
			return { code: 0, stdout: 'keychain: "login.keychain-db"\n', stderr: "" };
		return { code: 0, stdout: `${secret}\n`, stderr: "" };
	};
	return { run, calls, items };
}

function open(
	backend: "keychain" | "secret-tool",
	root: string,
	run: FakeRun,
	defaultHome = root,
) {
	return createKeyStore({
		home: root,
		defaultHome,
		selection: backend,
		env: {},
		platform: backend === "keychain" ? "darwin" : "linux",
		which: () => "/fake/secret-tool",
		securityPath: "/usr/bin/security",
		run,
	});
}

/** True when any 16-character run of the secret appears in the text. */
function leaksSecret(text: string, secret = key.slice(key.indexOf(".") + 1)) {
	for (let i = 0; i + 16 <= secret.length; i++)
		if (text.includes(secret.slice(i, i + 16))) return true;
	return false;
}

for (const backend of ["keychain", "secret-tool", "file"] as const) {
	test(`${backend} implements the common store contract without exposing the secret`, async () => {
		const root = await home();
		const fake = fakeStore();
		const store = await createKeyStore({
			home: root,
			selection: backend,
			env: {},
			platform: backend === "keychain" ? "darwin" : "linux",
			which: () => "/fake/secret-tool",
			securityPath: "/fake/security",
			run: fake.run,
		});
		expect(store.backend).toBe(backend);
		await store.checkWritable(owner);
		await store.put(owner, key, meta);
		expect(await store.get(owner)).toEqual({ key, meta });
		expect(await store.describe(owner)).toEqual({
			prefix: "mobius_01234567-89ab-cdef-0123-456789abcdef…",
			backend,
			meta,
		});
		expect(JSON.stringify(await store.describe(owner))).not.toContain(
			"ab".repeat(32),
		);
		expect(await store.delete(owner)).toBe(true);
		expect(await store.get(owner)).toBeNull();
		expect(await store.delete(owner)).toBe(false);
	});
}

test("keychain puts the key only on stdin of `security -i`, reads it back, and uses the fixed command", async () => {
	const fake = fakeStore();
	const root = await home();
	const store = await open("keychain", root, fake.run);
	await store.put(owner, key, meta);
	await store.get(owner);
	await store.delete(owner);
	expect(fake.calls).toEqual([
		{
			argv: ["/usr/bin/security", "-i"],
			stdin: `add-generic-password -U -s "mstack.mobius-api" -a "${owner.toLowerCase()}" -w "${key}"\n`,
		},
		{
			argv: [
				"/usr/bin/security",
				"find-generic-password",
				"-w",
				"-s",
				"mstack.mobius-api",
				"-a",
				owner.toLowerCase(),
			],
			stdin: undefined,
		},
		{
			argv: [
				"/usr/bin/security",
				"find-generic-password",
				"-w",
				"-s",
				"mstack.mobius-api",
				"-a",
				owner.toLowerCase(),
			],
			stdin: undefined,
		},
		{
			argv: [
				"/usr/bin/security",
				"delete-generic-password",
				"-s",
				"mstack.mobius-api",
				"-a",
				owner.toLowerCase(),
			],
			stdin: undefined,
		},
	]);
	for (const call of fake.calls)
		expect(leaksSecret(call.argv.join(" "))).toBe(false);
});

test("security -i quoting survives the parser for quotes and backslashes", async () => {
	const fake = fakeStore();
	const root = await home();
	const store = await open("keychain", root, fake.run, join(root, "other"));
	await store.put(owner, key, meta);
	const [line] = fake.calls.map((call) => call.stdin).filter(Boolean);
	expect(securityWords(line ?? "")).toEqual([
		"add-generic-password",
		"-U",
		"-s",
		expect.stringMatching(/^mstack\.mobius-api:[0-9a-f]{16}$/),
		"-a",
		owner.toLowerCase(),
		"-w",
		key,
	]);
	expect(securityWords('x "a\\"b\\\\c"')).toEqual(["x", 'a"b\\c']);
});

test("keychain treats a silent `security -i` failure or a read-back mismatch as an error and keeps no metadata", async () => {
	for (const failure of [
		// security -i exits with the last command's status, which can be 0.
		(argv: string[]) =>
			argv[1] === "-i"
				? {
						code: 0,
						stdout: "",
						stderr: "add-generic-password: returned -25308",
					}
				: undefined,
		(argv: string[]) => (argv[1] === "-i" ? ok : undefined),
	]) {
		const root = await home();
		const fake = fakeStore(failure);
		const store = await open("keychain", root, fake.run);
		const error = await store.put(owner, key, meta).catch((caught) => caught);
		expect(error).toBeInstanceOf(Error);
		expect(leaksSecret(String(error))).toBe(false);
		expect(await readdir(join(root, "keys"))).toEqual([]);
	}
});

test("secret-tool sends the secret only on stdin", async () => {
	const fake = fakeStore();
	const root = await home();
	const store = await open("secret-tool", root, fake.run);
	await store.put(owner, key, meta);
	expect(fake.calls[0]).toEqual({
		argv: [
			"/fake/secret-tool",
			"store",
			"--label",
			"mstack MoB API key",
			"service",
			"mstack.mobius-api",
			"owner",
			owner.toLowerCase(),
		],
		stdin: `${key}\n`,
	});
	for (const call of fake.calls)
		expect(leaksSecret(call.argv.join(" "))).toBe(false);
});

test("only item-not-found counts as missing; a locked or unavailable store throws a redacted error", async () => {
	const cases = [
		{
			backend: "keychain" as const,
			failed: {
				code: 36,
				stdout: "",
				stderr: `security: SecKeychainItemCopyContent: User interaction is not allowed. ${key}`,
			},
		},
		{
			backend: "secret-tool" as const,
			failed: {
				code: 1,
				stdout: "",
				stderr: "secret-tool: Cannot autolaunch D-Bus without X11 $DISPLAY",
			},
		},
	];
	for (const { backend, failed } of cases) {
		const root = await home();
		const healthy = await open(backend, root, fakeStore().run);
		expect(await healthy.get(owner)).toBeNull();
		const broken = await open(
			backend,
			root,
			fakeStore((argv) =>
				argv.includes("store") || argv[1] === "-i" ? undefined : failed,
			).run,
		);
		for (const action of [
			() => broken.get(owner),
			() => broken.delete(owner),
			() => broken.checkWritable(owner),
		]) {
			const error = await action().catch((caught) => caught);
			expect(error).toBeInstanceOf(Error);
			expect(String(error)).toContain("Credential store failed");
			expect(leaksSecret(String(error))).toBe(false);
		}
	}
});

test("a put that fails on its metadata stores no secret", async () => {
	for (const backend of ["keychain", "secret-tool"] as const) {
		const root = await home();
		await mkdir(join(root, "keys"), { mode: 0o755 });
		await chmod(join(root, "keys"), 0o755);
		const fake = fakeStore();
		const store = await open(backend, root, fake.run);
		await expect(store.put(owner, key, meta)).rejects.toThrow("mode 0700");
		expect(fake.items.size).toBe(0);
		await chmod(join(root, "keys"), 0o700);
		await expect(
			store.put(owner, key, { ...meta, apiBase: "http://203.0.113.9" }),
		).rejects.toThrow("Invalid key apiBase");
		expect(fake.items.size).toBe(0);
		expect(await readdir(join(root, "keys"))).toEqual([]);
	}
});

test("a put whose secret write fails leaves neither metadata nor a temporary file", async () => {
	const root = await home();
	const fake = fakeStore((argv) =>
		argv[1] === "store"
			? { code: 1, stdout: "", stderr: "secret-tool: Prompt dismissed" }
			: undefined,
	);
	const store = await open("secret-tool", root, fake.run);
	await expect(store.put(owner, key, meta)).rejects.toThrow("Prompt dismissed");
	expect(await readdir(join(root, "keys"))).toEqual([]);
});

test("the per-home metadata records the key id, never the secret", async () => {
	const root = await home();
	const store = await open("keychain", root, fakeStore().run);
	await store.put(owner, key, meta);
	const raw = await readFile(
		join(root, "keys", `${owner.toLowerCase()}.meta.json`),
		"utf8",
	);
	expect(JSON.parse(raw)).toEqual({
		...meta,
		keyId: "01234567-89ab-cdef-0123-456789abcdef",
	});
	expect(leaksSecret(raw)).toBe(false);
});

for (const backend of ["keychain", "secret-tool"] as const) {
	test(`${backend}: two homes for one wallet keep separate keys; the default home keeps the original name`, async () => {
		const shared = fakeStore();
		const defaultHome = await home();
		const sandbox = await home();
		const real = await open(backend, defaultHome, shared.run, defaultHome);
		const lab = await open(backend, sandbox, shared.run, defaultHome);
		const labKey = `mobius_00000000-0000-4000-8000-000000000001.${"cd".repeat(32)}`;
		const labMeta = { ...meta, apiBase: "http://127.0.0.1:4000" };
		await real.put(owner, key, meta);
		await lab.put(owner, labKey, labMeta);
		expect(await real.get(owner)).toEqual({ key, meta });
		expect(await lab.get(owner)).toEqual({ key: labKey, meta: labMeta });
		const services = [...shared.items.keys()].map((item) => item.split("|")[0]);
		expect(services).toContain("mstack.mobius-api");
		expect(
			services.filter((name) => /^mstack\.mobius-api:[0-9a-f]{16}$/.test(name)),
		).toHaveLength(1);
		expect(await lab.delete(owner)).toBe(true);
		expect(await lab.get(owner)).toBeNull();
		expect(await real.get(owner)).toEqual({ key, meta });
	});
}

/** A non-default home as an older build left it: the secret under the legacy
 * name and metadata in the home, with or without the key id. */
async function legacyHome(
	shared: ReturnType<typeof fakeStore>,
	secret: string,
	keyId?: string,
) {
	const root = await home();
	await mkdir(join(root, "keys"), { mode: 0o700 });
	await writeFile(
		join(root, "keys", `${owner.toLowerCase()}.meta.json`),
		JSON.stringify({ ...meta, ...(keyId ? { keyId } : {}) }),
		{ mode: 0o600 },
	);
	shared.items.set(`mstack.mobius-api|${owner.toLowerCase()}`, secret);
	return root;
}

test("a non-default home moves its legacy item only when the key id matches its metadata", async () => {
	const keyId = "01234567-89ab-cdef-0123-456789abcdef";
	const unclaimed = join(await home(), "default-home-never-created");
	const legacy = `mstack.mobius-api|${owner.toLowerCase()}`;

	const moved = fakeStore();
	const root = await legacyHome(moved, key, keyId);
	const store = await open("keychain", root, moved.run, unclaimed);
	expect(await store.get(owner)).toEqual({ key, meta });
	expect(moved.items.has(legacy)).toBe(false);
	expect([...moved.items.values()]).toEqual([key]);
	expect(await store.get(owner)).toEqual({ key, meta });

	const other = `mobius_00000000-0000-4000-8000-000000000009.${"ef".repeat(32)}`;
	const foreign = fakeStore();
	const foreignHome = await legacyHome(foreign, other, keyId);
	expect(
		await (await open("keychain", foreignHome, foreign.run, unclaimed)).get(
			owner,
		),
	).toBeNull();
	expect(foreign.items.get(legacy)).toBe(other);

	const old = fakeStore();
	const oldHome = await legacyHome(old, key);
	expect(
		await (await open("secret-tool", oldHome, old.run, unclaimed)).get(owner),
	).toBeNull();
	expect(old.items.get(legacy)).toBe(key);
});

test("a migration copies but keeps the legacy item while the default home claims it", async () => {
	const shared = fakeStore();
	const defaultHome = await home();
	const real = await open("keychain", defaultHome, shared.run, defaultHome);
	await real.put(owner, key, meta);
	const lab = await legacyHome(
		shared,
		key,
		"01234567-89ab-cdef-0123-456789abcdef",
	);
	expect(
		await (await open("keychain", lab, shared.run, defaultHome)).get(owner),
	).toEqual({ key, meta });
	expect(await real.get(owner)).toEqual({ key, meta });
	expect(shared.items.size).toBe(2);
});

test("delete removes a credential whose metadata is missing and reports it", async () => {
	const shared = fakeStore();
	const root = await home();
	shared.items.set(`mstack.mobius-api|${owner.toLowerCase()}`, key);
	const store = await open("keychain", root, shared.run);
	await expect(store.get(owner)).rejects.toThrow("mob keys delete");
	expect(await store.delete(owner)).toBe(true);
	expect(shared.items.size).toBe(0);
	expect(await store.get(owner)).toBeNull();
	expect(await store.delete(owner)).toBe(false);
});

test("checkWritable refuses the read-only env store and an unsafe metadata target", async () => {
	const envStore = await createKeyStore({
		home: await home(),
		env: { MOBIUS_API_KEY: key },
	});
	await expect(envStore.checkWritable(owner)).rejects.toThrow(
		"MOBIUS_API_KEY is set and read-only",
	);
	for (const backend of ["keychain", "file"] as const) {
		const root = await home();
		await mkdir(join(root, "keys"), { mode: 0o700 });
		await writeFile(join(root, "target"), "x");
		await symlink(
			join(root, "target"),
			join(
				root,
				"keys",
				`${owner.toLowerCase()}${backend === "file" ? "" : ".meta"}.json`,
			),
		);
		const store = await createKeyStore({
			home: root,
			defaultHome: root,
			selection: backend,
			env: {},
			platform: "darwin",
			securityPath: "/fake/security",
			run: fakeStore().run,
		});
		await expect(store.checkWritable(owner)).rejects.toThrow("symlink");
	}
});

test("env always wins, is read-only, and does not write files", async () => {
	const root = await home();
	const store = await createKeyStore({
		home: root,
		selection: "file",
		env: { MOBIUS_API_KEY: key },
		platform: "linux",
		apiBase: meta.apiBase,
		now: () => meta.importedAt,
	});
	expect(store.backend).toBe("env");
	expect((await store.get(owner))?.key).toBe(key);
	await expect(store.put(owner, key, meta)).rejects.toThrow("read-only");
	await expect(store.delete(owner)).rejects.toThrow("read-only");
	expect(await lstat(root).then(() => true)).toBe(true);
	expect(
		await lstat(join(root, "keys")).then(
			() => true,
			() => false,
		),
	).toBe(false);
});

test("auto chooses the platform store and falls back to file", async () => {
	for (const [platform, found, backend] of [
		["darwin", null, "keychain"],
		["linux", "/usr/bin/secret-tool", "secret-tool"],
		["linux", null, "file"],
	] as const) {
		const store = await createKeyStore({
			home: await home(),
			selection: "auto",
			env: {},
			platform,
			which: () => found,
			securityPath: "/fake/security",
			run: fakeStore().run,
		});
		expect(store.backend).toBe(backend as KeyStoreBackend);
	}
});

test("file storage is private and rejects symlinks or wrong modes", async () => {
	const root = await home();
	const store = await createKeyStore({
		home: root,
		selection: "file",
		env: {},
		platform: "linux",
	});
	await store.put(owner, key, meta);
	const dir = join(root, "keys");
	const file = join(dir, `${owner.toLowerCase()}.json`);
	expect((await lstat(dir)).mode & 0o777).toBe(0o700);
	expect((await lstat(file)).mode & 0o777).toBe(0o600);
	expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ key, meta });
	await chmod(file, 0o644);
	await expect(store.get(owner)).rejects.toThrow("mode 0600");
	await rm(file);
	await writeFile(join(root, "target"), "x");
	await symlink(join(root, "target"), file);
	await expect(store.get(owner)).rejects.toThrow("symlink");
	await rm(file);
	await chmod(dir, 0o755);
	await expect(store.get(owner)).rejects.toThrow("mode 0700");
	await expect(store.delete(owner)).rejects.toThrow("mode 0700");
});

test("file storage rejects a symlinked keys directory", async () => {
	const root = await home();
	const target = join(root, "target");
	await mkdir(target, { mode: 0o700 });
	await symlink(target, join(root, "keys"));
	const store = await createKeyStore({
		home: root,
		selection: "file",
		env: {},
		platform: "linux",
	});
	await expect(store.put(owner, key, meta)).rejects.toThrow("symlink");
});
