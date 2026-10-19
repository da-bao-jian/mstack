import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import {
	chmod,
	lstat,
	mkdir,
	readFile,
	rename,
	unlink,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { isApiKey, prefixOf, redactKey } from "./format.ts";
import type {
	KeyDescription,
	KeyMeta,
	KeyStore,
	KeyStoreBackend,
	KeyStoreSelection,
	StoredKey,
} from "./types.ts";

type RunResult = { code: number; stdout: string; stderr: string };
export type CommandRunner = (
	argv: string[],
	stdin?: string,
) => Promise<RunResult>;

export interface KeyStoreOptions {
	home: string;
	selection?: KeyStoreSelection;
	env?: Record<string, string | undefined>;
	platform?: NodeJS.Platform;
	which?: (command: string) => string | null;
	securityPath?: string;
	run?: CommandRunner;
	now?: () => number;
	apiBase?: string;
	/** The home whose credentials keep the original name (default ~/.mob). */
	defaultHome?: string;
}

const SERVICE = "mstack.mobius-api";

function canonical(path: string): string {
	const absolute = resolve(path);
	try {
		return realpathSync(absolute);
	} catch {
		return absolute;
	}
}

/** The credential-store service name for a home. The default home keeps the
 * original name, so existing keys still resolve; any other home gets its own,
 * so two homes for one wallet never read, overwrite, or delete each other's
 * key while each keeps its own metadata. */
function serviceFor(home: string, defaultHome: string): string {
	const path = canonical(home);
	if (path === canonical(defaultHome)) return SERVICE;
	return `${SERVICE}:${createHash("sha256").update(path).digest("hex").slice(0, 16)}`;
}

function ownerId(owner: string): string {
	if (!/^0x[0-9a-f]{40}$/i.test(owner)) throw new Error("Invalid key owner");
	return owner.toLowerCase();
}

function validateMeta(meta: KeyMeta): KeyMeta {
	if (!Number.isSafeInteger(meta.importedAt) || meta.importedAt < 0)
		throw new Error("Invalid key importedAt");
	if (
		meta.verifiedAt !== undefined &&
		(!Number.isSafeInteger(meta.verifiedAt) || meta.verifiedAt < 0)
	)
		throw new Error("Invalid key verifiedAt");
	if (
		meta.name !== undefined &&
		(!meta.name.trim() || /[\p{Cc}\p{Cf}]/u.test(meta.name))
	)
		throw new Error("Invalid key name");
	if (
		meta.venues !== undefined &&
		(meta.venues.length === 0 ||
			meta.venues.some((venue) => !/^[a-z0-9][a-z0-9-]*$/.test(venue)))
	)
		throw new Error("Invalid key venues");
	if (
		meta.maxSizeUsd !== undefined &&
		(!Number.isFinite(meta.maxSizeUsd) || meta.maxSizeUsd <= 0)
	)
		throw new Error("Invalid key maxSizeUsd");
	const url = new URL(meta.apiBase);
	if (
		!["https:", "http:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		throw new Error("Invalid key apiBase");
	return structuredClone(meta);
}

function validateStored(value: unknown): StoredKey {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid stored key record");
	const record = value as Record<string, unknown>;
	if (typeof record.key !== "string" || !isApiKey(record.key))
		throw new Error("Invalid stored Mobius API key");
	return { key: record.key, meta: validateMeta(record.meta as KeyMeta) };
}

async function status(path: string) {
	try {
		return await lstat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

async function privateDirectory(path: string): Promise<void> {
	const existing = await status(path);
	if (!existing) {
		await mkdir(path, { recursive: true, mode: 0o700 });
		await chmod(path, 0o700);
		return;
	}
	if (existing.isSymbolicLink())
		throw new Error(`${path}: symlink is not allowed`);
	if (!existing.isDirectory()) throw new Error(`${path}: expected a directory`);
	if ((existing.mode & 0o777) !== 0o700)
		throw new Error(`${path}: expected mode 0700`);
}

async function readPrivate(path: string): Promise<string | null> {
	const file = await status(path);
	if (!file) return null;
	if (file.isSymbolicLink()) throw new Error(`${path}: symlink is not allowed`);
	if (!file.isFile()) throw new Error(`${path}: expected a regular file`);
	if ((file.mode & 0o777) !== 0o600)
		throw new Error(`${path}: expected mode 0600`);
	return readFile(path, "utf8");
}

async function atomicPrivate(path: string, contents: string): Promise<void> {
	const current = await status(path);
	if (current && (current.isSymbolicLink() || !current.isFile()))
		throw new Error(`${path}: symlink or non-file target is not allowed`);
	if (current && (current.mode & 0o777) !== 0o600)
		throw new Error(`${path}: expected mode 0600`);
	const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
	await writeFile(temporary, contents, { flag: "wx", mode: 0o600 });
	await chmod(temporary, 0o600);
	try {
		await rename(temporary, path);
	} catch (error) {
		await unlink(temporary).catch(() => {});
		throw error;
	}
}

const defaultRun: CommandRunner = async (argv, stdin) => {
	const child = Bun.spawn(argv, {
		stdin: stdin === undefined ? "ignore" : "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	if (stdin !== undefined) {
		child.stdin?.write(stdin);
		child.stdin?.end();
	}
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { code, stdout, stderr };
};

abstract class BaseStore implements KeyStore {
	abstract readonly backend: KeyStoreBackend;
	constructor(protected readonly home: string) {}
	abstract put(owner: string, key: string, meta: KeyMeta): Promise<void>;
	abstract get(owner: string): Promise<StoredKey | null>;
	abstract delete(owner: string): Promise<boolean>;
	async describe(owner: string): Promise<KeyDescription | null> {
		const stored = await this.get(owner);
		return stored
			? {
					prefix: prefixOf(stored.key),
					backend: this.backend,
					meta: stored.meta,
				}
			: null;
	}
	protected directory() {
		return join(this.home, "keys");
	}
	protected metaPath(owner: string) {
		return join(this.directory(), `${ownerId(owner)}.meta.json`);
	}
	protected async writeMeta(owner: string, meta: KeyMeta) {
		await privateDirectory(this.home);
		await privateDirectory(this.directory());
		await atomicPrivate(
			this.metaPath(owner),
			`${JSON.stringify(validateMeta(meta), null, 2)}\n`,
		);
	}
	protected async readMeta(owner: string): Promise<KeyMeta | null> {
		await privateDirectory(this.home);
		await privateDirectory(this.directory());
		const raw = await readPrivate(this.metaPath(owner));
		if (raw === null) return null;
		try {
			return validateMeta(JSON.parse(raw));
		} catch (error) {
			throw new Error(
				`${this.metaPath(owner)}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	protected async deleteMeta(owner: string) {
		const path = this.metaPath(owner);
		await readPrivate(path);
		await unlink(path).catch((error) => {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		});
	}
}

class EnvStore extends BaseStore {
	readonly backend = "env" as const;
	constructor(
		home: string,
		private readonly secret: string,
		private readonly meta: KeyMeta,
	) {
		super(home);
	}
	async put(): Promise<void> {
		throw new Error("MOBIUS_API_KEY is read-only");
	}
	async get(owner: string): Promise<StoredKey> {
		ownerId(owner);
		if (!isApiKey(this.secret))
			throw new Error("MOBIUS_API_KEY has an invalid format");
		return { key: this.secret, meta: validateMeta(this.meta) };
	}
	async delete(): Promise<boolean> {
		throw new Error("MOBIUS_API_KEY is read-only");
	}
}

class FileStore extends BaseStore {
	readonly backend = "file" as const;
	private path(owner: string) {
		return join(this.directory(), `${ownerId(owner)}.json`);
	}
	async put(owner: string, secret: string, meta: KeyMeta) {
		if (!isApiKey(secret)) throw new Error("Invalid Mobius API key");
		await privateDirectory(this.home);
		await privateDirectory(this.directory());
		await atomicPrivate(
			this.path(owner),
			`${JSON.stringify({ key: secret, meta: validateMeta(meta) }, null, 2)}\n`,
		);
	}
	async get(owner: string): Promise<StoredKey | null> {
		await privateDirectory(this.home);
		await privateDirectory(this.directory());
		const raw = await readPrivate(this.path(owner));
		if (raw === null) return null;
		try {
			return validateStored(JSON.parse(raw));
		} catch (error) {
			throw new Error(
				`${this.path(owner)}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	async delete(owner: string): Promise<boolean> {
		await privateDirectory(this.home);
		await privateDirectory(this.directory());
		const path = this.path(owner);
		const existing = await readPrivate(path);
		if (existing === null) return false;
		await unlink(path);
		return true;
	}
}

abstract class CommandStore extends BaseStore {
	constructor(
		home: string,
		protected readonly run: CommandRunner,
		private readonly defaultHome: string,
	) {
		super(home);
	}
	/** Creates the home first when writing, so its name never changes later. */
	protected async service(create = false): Promise<string> {
		if (create) await privateDirectory(this.home);
		return serviceFor(this.home, this.defaultHome);
	}
	protected async execute(
		argv: string[],
		stdin?: string,
		missing = false,
	): Promise<string | null> {
		const result = await this.run(argv, stdin);
		if (result.code === 0) return result.stdout.trim();
		if (missing) return null;
		throw new Error(
			redactKey(
				`Credential store failed (${result.code}): ${result.stderr.trim() || "no detail"}`,
			),
		);
	}
	protected async finishGet(
		owner: string,
		secret: string | null,
	): Promise<StoredKey | null> {
		if (secret === null) return null;
		if (!isApiKey(secret))
			throw new Error("Credential store returned an invalid Mobius API key");
		const meta = await this.readMeta(owner);
		if (!meta) throw new Error("Key metadata is missing");
		return { key: secret, meta };
	}
}

class KeychainStore extends CommandStore {
	readonly backend = "keychain" as const;
	constructor(
		home: string,
		run: CommandRunner,
		defaultHome: string,
		private readonly command: string,
	) {
		super(home, run, defaultHome);
	}
	private async base(owner: string, create = false) {
		return ["-s", await this.service(create), "-a", ownerId(owner)];
	}
	async put(owner: string, secret: string, meta: KeyMeta) {
		if (!isApiKey(secret)) throw new Error("Invalid Mobius API key");
		// macOS security accepts the password only on argv. This creates a brief
		// same-user process-list exposure while this single child runs.
		await this.execute([
			this.command,
			"add-generic-password",
			"-U",
			...(await this.base(owner, true)),
			"-w",
			secret,
		]);
		await this.writeMeta(owner, meta);
	}
	async get(owner: string) {
		return this.finishGet(
			owner,
			await this.execute(
				[
					this.command,
					"find-generic-password",
					"-w",
					...(await this.base(owner)),
				],
				undefined,
				true,
			),
		);
	}
	async delete(owner: string) {
		if (!(await this.get(owner))) return false;
		await this.execute([
			this.command,
			"delete-generic-password",
			...(await this.base(owner)),
		]);
		await this.deleteMeta(owner);
		return true;
	}
}

class SecretToolStore extends CommandStore {
	readonly backend = "secret-tool" as const;
	constructor(
		home: string,
		run: CommandRunner,
		defaultHome: string,
		private readonly command: string,
	) {
		super(home, run, defaultHome);
	}
	// A distinct service value, not an extra attribute: a lookup matches items
	// that carry more attributes than it names.
	private async attrs(owner: string, create = false) {
		return ["service", await this.service(create), "owner", ownerId(owner)];
	}
	async put(owner: string, secret: string, meta: KeyMeta) {
		if (!isApiKey(secret)) throw new Error("Invalid Mobius API key");
		await this.execute(
			[
				this.command,
				"store",
				"--label",
				"mstack Mobius API key",
				...(await this.attrs(owner, true)),
			],
			`${secret}\n`,
		);
		await this.writeMeta(owner, meta);
	}
	async get(owner: string) {
		return this.finishGet(
			owner,
			await this.execute(
				[this.command, "lookup", ...(await this.attrs(owner))],
				undefined,
				true,
			),
		);
	}
	async delete(owner: string) {
		if (!(await this.get(owner))) return false;
		await this.execute([this.command, "clear", ...(await this.attrs(owner))]);
		await this.deleteMeta(owner);
		return true;
	}
}

export async function createKeyStore(
	options: KeyStoreOptions,
): Promise<KeyStore> {
	const env = options.env ?? process.env;
	const now = options.now ?? Date.now;
	if (env.MOBIUS_API_KEY)
		return new EnvStore(options.home, env.MOBIUS_API_KEY, {
			importedAt: now(),
			apiBase: options.apiBase ?? "https://api.mob.exchange",
		});
	const selection = options.selection ?? "auto";
	if (selection === "env") throw new Error("MOBIUS_API_KEY is not set");
	const platform = options.platform ?? process.platform;
	const which = options.which ?? Bun.which;
	const backend: KeyStoreBackend =
		selection === "auto"
			? platform === "darwin"
				? "keychain"
				: platform === "linux" && which("secret-tool")
					? "secret-tool"
					: "file"
			: selection;
	const run = options.run ?? defaultRun;
	const defaultHome = options.defaultHome ?? join(homedir(), ".mob");
	if (backend === "keychain") {
		if (platform !== "darwin")
			throw new Error("keychain is available only on macOS");
		return new KeychainStore(
			options.home,
			run,
			defaultHome,
			options.securityPath ?? "/usr/bin/security",
		);
	}
	if (backend === "secret-tool") {
		if (platform !== "linux")
			throw new Error("secret-tool is available only on Linux");
		const command = which("secret-tool");
		if (!command) throw new Error("secret-tool is not installed");
		return new SecretToolStore(options.home, run, defaultHome, command);
	}
	return new FileStore(options.home);
}
