import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { lstat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { isSecureBase } from "@mstack/mobius-api";
import { isApiKey, keyIdOf, prefixOf, redactKey } from "./format.ts";
import {
	assertPrivateTarget,
	atomicPrivate,
	privateDirectory,
	readPrivate,
	stagePrivate,
} from "./private-file.ts";
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
	// The key is sent to this base, so it must be HTTPS or this machine.
	if (
		!isSecureBase(url) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		throw new Error("Invalid key apiBase");
	return structuredClone(meta);
}

/** Per-home metadata: the public KeyMeta plus the stored key's id. */
interface MetaRecord {
	meta: KeyMeta;
	keyId?: string;
}

function parseMetaRecord(value: unknown): MetaRecord {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid key metadata");
	const { keyId, ...meta } = value as KeyMeta & { keyId?: unknown };
	if (keyId !== undefined && (typeof keyId !== "string" || !UUID.test(keyId)))
		throw new Error("Invalid key id");
	return {
		meta: validateMeta(meta),
		...(keyId === undefined ? {} : { keyId }),
	};
}

function validateStored(value: unknown): StoredKey {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid stored key record");
	const record = value as Record<string, unknown>;
	if (typeof record.key !== "string" || !isApiKey(record.key))
		throw new Error("Invalid stored MoB API key");
	return { key: record.key, meta: validateMeta(record.meta as KeyMeta) };
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
	abstract checkWritable(owner: string): Promise<void>;
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
	protected async privateDirectories() {
		await privateDirectory(this.home);
		await privateDirectory(this.directory());
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
	async checkWritable(): Promise<void> {
		throw new Error(
			"MOBIUS_API_KEY is set and read-only, so mob cannot store a new key; unset it first",
		);
	}
}

class FileStore extends BaseStore {
	readonly backend = "file" as const;
	private path(owner: string) {
		return join(this.directory(), `${ownerId(owner)}.json`);
	}
	async put(owner: string, secret: string, meta: KeyMeta) {
		if (!isApiKey(secret)) throw new Error("Invalid MoB API key");
		await this.privateDirectories();
		await atomicPrivate(
			this.path(owner),
			`${JSON.stringify({ key: secret, meta: validateMeta(meta) }, null, 2)}\n`,
		);
	}
	async get(owner: string): Promise<StoredKey | null> {
		await this.privateDirectories();
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
		await this.privateDirectories();
		const path = this.path(owner);
		const existing = await readPrivate(path);
		if (existing === null) return false;
		await unlink(path);
		return true;
	}
	async checkWritable(owner: string): Promise<void> {
		await this.privateDirectories();
		await assertPrivateTarget(this.path(owner));
	}
}

/** Keychain and Secret Service: the secret lives in the OS store under a
 * per-home service name; its metadata lives in `keys/<owner>.meta.json`. */
abstract class CommandStore extends BaseStore {
	constructor(
		home: string,
		protected readonly run: CommandRunner,
		private readonly defaultHome: string,
	) {
		super(home);
	}
	protected abstract lookup(
		service: string,
		owner: string,
	): Promise<string | null>;
	protected abstract store(
		service: string,
		owner: string,
		secret: string,
	): Promise<void>;
	/** True when an item existed and was removed. */
	protected abstract remove(service: string, owner: string): Promise<boolean>;
	/** Throws unless the store answers (found or not found) for this item. */
	protected abstract probe(service: string, owner: string): Promise<void>;

	/** Creates the home first when writing, so its name never changes later. */
	protected async service(create = false): Promise<string> {
		if (create) await privateDirectory(this.home);
		return serviceFor(this.home, this.defaultHome);
	}
	/** Runs the store command. A failure that `missing` accepts is "not found"
	 * (null); any other failure (locked, denied, no D-Bus) throws. */
	protected async execute(
		argv: string[],
		stdin?: string,
		missing?: (result: RunResult) => boolean,
	): Promise<string | null> {
		const result = await this.run(argv, stdin);
		if (result.code === 0) return result.stdout.trim();
		if (missing?.(result)) return null;
		throw new Error(
			redactKey(
				`Credential store failed (${result.code}): ${result.stderr.trim() || "no detail"}`,
			),
		);
	}
	private metaPath(owner: string) {
		return join(this.directory(), `${ownerId(owner)}.meta.json`);
	}
	private async readMetaRecord(owner: string): Promise<MetaRecord | null> {
		await this.privateDirectories();
		const raw = await readPrivate(this.metaPath(owner));
		if (raw === null) return null;
		try {
			return parseMetaRecord(JSON.parse(raw));
		} catch (error) {
			throw new Error(
				`${this.metaPath(owner)}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	/** The key id in this home's metadata; null when absent or unreadable, so
	 * a delete still removes the credential. */
	private async metaKeyId(owner: string): Promise<string | null> {
		try {
			return (await this.readMetaRecord(owner))?.keyId ?? null;
		} catch {
			return null;
		}
	}
	/** The default home owns the legacy name while it has metadata there. */
	private async defaultHomeClaims(owner: string): Promise<boolean> {
		return lstat(
			join(this.defaultHome, "keys", `${ownerId(owner)}.meta.json`),
		).then(
			() => true,
			() => false,
		);
	}
	/** A non-default home stored its key under the legacy name before names
	 * were per home. Move that item only when its key id is the one this home's
	 * metadata names; otherwise it may be another home's key. */
	private async migrate(
		service: string,
		owner: string,
		keyId: string | null,
	): Promise<string | null> {
		if (service === SERVICE || !keyId) return null;
		const legacy = await this.lookup(SERVICE, owner);
		if (legacy === null || !isApiKey(legacy) || keyIdOf(legacy) !== keyId)
			return null;
		await this.store(service, owner, legacy);
		if (!(await this.defaultHomeClaims(owner)))
			await this.remove(SERVICE, owner);
		return legacy;
	}
	async put(owner: string, secret: string, meta: KeyMeta) {
		if (!isApiKey(secret)) throw new Error("Invalid MoB API key");
		const service = await this.service(true);
		await this.privateDirectories();
		// Metadata is written and checked first and committed last, so a put
		// that fails never leaves a secret without its metadata.
		const staged = await stagePrivate(
			this.metaPath(owner),
			`${JSON.stringify({ ...validateMeta(meta), keyId: keyIdOf(secret) }, null, 2)}\n`,
		);
		try {
			await this.store(service, owner, secret);
		} catch (error) {
			await staged.abort();
			throw error;
		}
		try {
			await staged.commit();
		} catch (error) {
			await this.remove(service, owner).catch(() => false);
			throw error;
		}
	}
	async get(owner: string): Promise<StoredKey | null> {
		const service = await this.service();
		const secret =
			(await this.lookup(service, owner)) ??
			(await this.migrate(service, owner, await this.metaKeyId(owner)));
		if (secret === null) return null;
		if (!isApiKey(secret))
			throw new Error("Credential store returned an invalid MoB API key");
		const record = await this.readMetaRecord(owner);
		if (!record)
			throw new Error(
				"Key metadata is missing; delete the stored key (mob keys delete) and import it again",
			);
		return { key: secret, meta: record.meta };
	}
	async delete(owner: string): Promise<boolean> {
		const service = await this.service();
		await this.privateDirectories();
		await this.migrate(service, owner, await this.metaKeyId(owner));
		const removed = await this.remove(service, owner);
		const path = this.metaPath(owner);
		const hadMeta = (await readPrivate(path).catch(() => "")) !== null;
		await unlink(path).catch((error) => {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		});
		return removed || hadMeta;
	}
	async checkWritable(owner: string): Promise<void> {
		const service = await this.service(true);
		await this.privateDirectories();
		await assertPrivateTarget(this.metaPath(owner));
		await this.probe(service, owner);
	}
}

/** Quotes one argument for the `security -i` command parser, which reads
 * double-quoted words with backslash escapes, one command per line. */
function securityWord(value: string): string {
	if (/[\0\r\n]/.test(value))
		throw new Error("Invalid credential store argument");
	return `"${value.replace(/[\\"]/g, "\\$&")}"`;
}

// errSecItemNotFound: the only `security` failure that means "no such item".
const keychainMissing = (result: RunResult) => result.code === 44;

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
	protected lookup(service: string, owner: string) {
		return this.execute(
			[
				this.command,
				"find-generic-password",
				"-w",
				"-s",
				service,
				"-a",
				ownerId(owner),
			],
			undefined,
			keychainMissing,
		);
	}
	protected async store(service: string, owner: string, secret: string) {
		// `security -i` reads the command from stdin, so the key is on no
		// process's argv. It exits with the last command's status and can
		// report success for a failed add, so the item is read back.
		const result = await this.run(
			[this.command, "-i"],
			`add-generic-password -U -s ${securityWord(service)} -a ${securityWord(ownerId(owner))} -w ${securityWord(secret)}\n`,
		);
		if (result.code !== 0 || /\breturned -?\d+/.test(result.stderr))
			throw new Error(
				redactKey(
					`Credential store failed (${result.code}): ${result.stderr.replaceAll(secret, "…").trim() || "no detail"}`,
				),
			);
		if ((await this.lookup(service, owner)) !== secret)
			throw new Error(
				"Credential store did not keep the key (read-back mismatch)",
			);
	}
	protected async remove(service: string, owner: string) {
		return (
			(await this.execute(
				[
					this.command,
					"delete-generic-password",
					"-s",
					service,
					"-a",
					ownerId(owner),
				],
				undefined,
				keychainMissing,
			)) !== null
		);
	}
	protected async probe(service: string, owner: string) {
		// Without -w: attributes only, never the secret.
		await this.execute(
			[
				this.command,
				"find-generic-password",
				"-s",
				service,
				"-a",
				ownerId(owner),
			],
			undefined,
			keychainMissing,
		);
	}
}

// secret-tool lookup exits 1 with no output for a missing item; a locked
// collection or a missing D-Bus session prints an error.
const secretToolMissing = (result: RunResult) =>
	result.code === 1 && !result.stdout.trim() && !result.stderr.trim();

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
	private attrs(service: string, owner: string) {
		return ["service", service, "owner", ownerId(owner)];
	}
	protected lookup(service: string, owner: string) {
		return this.execute(
			[this.command, "lookup", ...this.attrs(service, owner)],
			undefined,
			secretToolMissing,
		);
	}
	protected async store(service: string, owner: string, secret: string) {
		await this.execute(
			[
				this.command,
				"store",
				"--label",
				"mstack MoB API key",
				...this.attrs(service, owner),
			],
			`${secret}\n`,
		);
	}
	protected async remove(service: string, owner: string) {
		// clear succeeds whether or not an item matched.
		if ((await this.lookup(service, owner)) === null) return false;
		await this.execute([this.command, "clear", ...this.attrs(service, owner)]);
		return true;
	}
	protected async probe(service: string, owner: string) {
		await this.lookup(service, owner);
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
