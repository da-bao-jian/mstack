import {
	createCipheriv,
	createDecipheriv,
	scrypt as nodeScrypt,
	randomBytes,
} from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { type Address, getAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Signer } from "./index.ts";
import { readSecretFromTty, type SecretReader } from "./tty.ts";

// Envelope shape from mobius@33ed2ece packages/kms/src/kek.ts (interface only).
// Local encryption adds a random salt, fixed scrypt parameters and authenticated address.
// Version 2 raises scrypt N from 2^15 to 2^17 and binds the format and every
// KDF parameter into the AES-GCM associated data. Version 1 files still unlock
// and are rewritten as version 2 after a successful unlock.
interface Keystore {
	version: 1 | 2;
	address: Address;
	kdf: { name: "scrypt"; salt: string; N: number; r: number; p: number };
	crypto: { iv: string; authTag: string; ciphertext: string };
}
const KDF = {
	1: { N: 2 ** 15, r: 8, p: 1 },
	2: { N: 2 ** 17, r: 8, p: 1 },
} as const;
// scrypt needs 128 * N * r bytes: 128 MiB at N = 2^17, so leave headroom.
const MAXMEM = 256 * 1024 * 1024;
const MIN_PASSPHRASE = 12;
const TEMPORARY = /^0x[0-9a-f]{40}\.json\.\d+\.[0-9a-f-]{36}\.tmp$/;

function derive(
	passphrase: string,
	salt: Buffer,
	version: Keystore["version"],
): Promise<Buffer> {
	return new Promise((resolve, reject) =>
		nodeScrypt(
			passphrase,
			salt,
			32,
			{ ...KDF[version], maxmem: MAXMEM },
			(err, key) => (err ? reject(err) : resolve(key)),
		),
	);
}
/** Version 1 binds the address; version 2 also binds the format and the KDF. */
function associatedData(value: Keystore): Buffer {
	const address = value.address.toLowerCase();
	if (value.version === 1) return Buffer.from(`mstack-keystore-v1:${address}`);
	const { N, r, p, salt } = value.kdf;
	return Buffer.from(
		`mstack-keystore-v2:${address}:scrypt:N=${N}:r=${r}:p=${p}:salt=${salt}`,
	);
}
function pathFor(home: string, address: string): string {
	return join(home, "keystore", `${getAddress(address).toLowerCase()}.json`);
}
function base64(value: string, size: number): Buffer {
	if (typeof value !== "string") throw new Error("Invalid keystore encoding");
	const bytes = Buffer.from(value, "base64");
	if (bytes.length !== size || bytes.toString("base64") !== value)
		throw new Error("Invalid keystore encoding");
	return bytes;
}
async function readStore(home: string, address: string): Promise<Keystore> {
	await checkDirectory(home);
	await checkDirectory(join(home, "keystore"));
	const file = await open(
		pathFor(home, address),
		constants.O_RDONLY | constants.O_NOFOLLOW,
	);
	try {
		const info = await file.stat();
		if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 16_384)
			throw new Error("Keystore must be a private 0600 file");
		const value = JSON.parse(await file.readFile("utf8")) as Keystore;
		const expected =
			value.version === 1 || value.version === 2
				? KDF[value.version]
				: undefined;
		if (
			!expected ||
			getAddress(value.address) !== getAddress(address) ||
			value.kdf?.name !== "scrypt" ||
			value.kdf.N !== expected.N ||
			value.kdf.r !== expected.r ||
			value.kdf.p !== expected.p
		)
			throw new Error("Invalid keystore metadata");
		base64(value.kdf.salt, 32);
		base64(value.crypto.iv, 12);
		base64(value.crypto.authTag, 16);
		base64(value.crypto.ciphertext, 32);
		return value;
	} finally {
		await file.close();
	}
}
async function checkDirectory(path: string) {
	const info = await lstat(path);
	if (!info.isDirectory() || (info.mode & 0o777) !== 0o700)
		throw new Error(
			`${path}: keystore directory must be private (0700), not a symlink`,
		);
}
/** Encrypts a private key as a version 2 keystore record. */
async function encrypt(
	address: Address,
	plaintext: Buffer,
	passphrase: string,
): Promise<Keystore> {
	const salt = randomBytes(32),
		iv = randomBytes(12);
	const key = await derive(passphrase, salt, 2);
	try {
		const value: Keystore = {
			version: 2,
			address,
			kdf: { name: "scrypt", salt: salt.toString("base64"), ...KDF[2] },
			crypto: { iv: iv.toString("base64"), authTag: "", ciphertext: "" },
		};
		const cipher = createCipheriv("aes-256-gcm", key, iv);
		cipher.setAAD(associatedData(value));
		const ciphertext = Buffer.concat([
			cipher.update(plaintext),
			cipher.final(),
		]);
		value.crypto.authTag = cipher.getAuthTag().toString("base64");
		value.crypto.ciphertext = ciphertext.toString("base64");
		return value;
	} finally {
		key.fill(0);
	}
}
/** Writes a keystore file: exclusive for a new key; for an upgrade, a 0600
 * temporary file (O_EXCL, O_NOFOLLOW) renamed over the regular private file. */
async function writeStore(
	home: string,
	value: Keystore,
	replace: boolean,
): Promise<void> {
	await checkDirectory(home);
	await checkDirectory(join(home, "keystore"));
	const path = pathFor(home, value.address);
	const target = replace
		? `${path}.${process.pid}.${crypto.randomUUID()}.tmp`
		: path;
	const file = await open(
		target,
		constants.O_WRONLY |
			constants.O_CREAT |
			constants.O_EXCL |
			constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await file.writeFile(`${JSON.stringify(value, null, 2)}\n`);
		await file.sync();
	} finally {
		await file.close();
	}
	if (!replace) return;
	try {
		const current = await lstat(path);
		if (!current.isFile() || (current.mode & 0o077) !== 0)
			throw new Error("Keystore must be a private 0600 file");
		await rename(target, path);
	} catch (error) {
		await unlink(target).catch(() => {});
		throw error;
	}
}
async function save(
	home: string,
	privateKey: Hex,
	read: SecretReader,
): Promise<Address> {
	const account = privateKeyToAccount(privateKey);
	const passphrase = await read("New keystore passphrase: ");
	if ([...passphrase].length < MIN_PASSPHRASE)
		throw new Error(
			`Passphrase must be at least ${MIN_PASSPHRASE} characters; nothing was saved`,
		);
	if (passphrase !== (await read("Repeat passphrase: ")))
		throw new Error("Passphrases do not match");
	const plaintext = Buffer.from(privateKey.slice(2), "hex");
	try {
		const value = await encrypt(account.address, plaintext, passphrase);
		await mkdir(join(home, "keystore"), { recursive: true, mode: 0o700 });
		await writeStore(home, value, false);
		return account.address;
	} finally {
		plaintext.fill(0);
	}
}
export async function createKeystore(
	home: string,
	read: SecretReader = readSecretFromTty,
): Promise<Address> {
	return save(home, generatePrivateKey(), read);
}
export async function importKeystore(
	home: string,
	read: SecretReader = readSecretFromTty,
): Promise<Address> {
	const key = await read("Private key (hidden): ");
	if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("Invalid private key");
	try {
		privateKeyToAccount(key as Hex);
	} catch {
		throw new Error("Invalid private key");
	}
	return save(home, key as Hex, read);
}
export async function listKeystores(home: string): Promise<Address[]> {
	let files: string[];
	try {
		files = await readdir(join(home, "keystore"));
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw err;
	}
	const addresses: Address[] = [];
	for (const file of files.sort()) {
		// An upgrade in progress (or interrupted) leaves only its own temporary file.
		if (TEMPORARY.test(file)) continue;
		if (!/^0x[0-9a-f]{40}\.json$/.test(file))
			throw new Error("Unexpected keystore file");
		const address = getAddress(file.slice(0, -5));
		await readStore(home, address);
		addresses.push(address);
	}
	return addresses;
}
export async function unlockKeystore(
	home: string,
	address: string,
	read: SecretReader = readSecretFromTty,
	options: { reusable?: boolean } = {},
): Promise<Signer> {
	const value = await readStore(home, address);
	const passphrase = await read(`Passphrase for ${value.address}: `);
	const key = await derive(
		passphrase,
		base64(value.kdf.salt, 32),
		value.version,
	);
	let plaintext: Buffer | undefined;
	try {
		const cipher = createDecipheriv(
			"aes-256-gcm",
			key,
			base64(value.crypto.iv, 12),
		);
		cipher.setAAD(associatedData(value));
		cipher.setAuthTag(base64(value.crypto.authTag, 16));
		plaintext = cipher.update(base64(value.crypto.ciphertext, 32));
		// Keep a reference before authentication, so failure also clears the bytes.
		cipher.final().fill(0);
		let account: ReturnType<typeof privateKeyToAccount> | undefined =
			privateKeyToAccount(`0x${plaintext.toString("hex")}`);
		if (account.address !== getAddress(address))
			throw new Error("Address mismatch");
		// Best effort: a failed rewrite leaves the version 1 file, which still
		// unlocks, and the next unlock tries again.
		if (value.version === 1)
			await encrypt(value.address, plaintext, passphrase)
				.then((upgraded) => writeStore(home, upgraded, true))
				.catch(() => {});
		const owner = account.address;
		const take = () => {
			if (!account)
				throw new Error("Keystore signer is closed or already used");
			const active = account;
			if (!options.reusable) account = undefined;
			return active;
		};
		return {
			address: async () => owner,
			signMessage: async (args) => take().signMessage(args),
			signTypedData: async (args) => take().signTypedData(args),
			close: async () => {
				account = undefined;
			},
		};
	} catch {
		throw new Error("Cannot unlock keystore: wrong passphrase or invalid file");
	} finally {
		key.fill(0);
		plaintext?.fill(0);
	}
}
