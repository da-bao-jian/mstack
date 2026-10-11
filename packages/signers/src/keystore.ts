import {
	createCipheriv,
	createDecipheriv,
	scrypt as nodeScrypt,
	randomBytes,
} from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { type Address, getAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Signer } from "./index.ts";
import { readSecretFromTty, type SecretReader } from "./tty.ts";

// Envelope shape from mobius@33ed2ece packages/kms/src/kek.ts (interface only).
// Local encryption adds a random salt, fixed scrypt parameters and authenticated address.
interface Keystore {
	version: 1;
	address: Address;
	kdf: { name: "scrypt"; salt: string; N: 32768; r: 8; p: 1 };
	crypto: { iv: string; authTag: string; ciphertext: string };
}
const parameters = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
function derive(passphrase: string, salt: Buffer): Promise<Buffer> {
	return new Promise((resolve, reject) =>
		nodeScrypt(passphrase, salt, 32, parameters, (err, key) =>
			err ? reject(err) : resolve(key),
		),
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
		if (
			value.version !== 1 ||
			getAddress(value.address) !== getAddress(address) ||
			value.kdf?.name !== "scrypt" ||
			value.kdf.N !== 32768 ||
			value.kdf.r !== 8 ||
			value.kdf.p !== 1
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
async function save(
	home: string,
	privateKey: Hex,
	read: SecretReader,
): Promise<Address> {
	const account = privateKeyToAccount(privateKey);
	const passphrase = await read("New keystore passphrase: ");
	if (!passphrase) throw new Error("Passphrase must not be empty");
	if (passphrase !== (await read("Repeat passphrase: ")))
		throw new Error("Passphrases do not match");
	const salt = randomBytes(32),
		iv = randomBytes(12);
	const key = await derive(passphrase, salt);
	const plaintext = Buffer.from(privateKey.slice(2), "hex");
	try {
		const cipher = createCipheriv("aes-256-gcm", key, iv);
		cipher.setAAD(
			Buffer.from(`mstack-keystore-v1:${account.address.toLowerCase()}`),
		);
		const ciphertext = Buffer.concat([
			cipher.update(plaintext),
			cipher.final(),
		]);
		const value: Keystore = {
			version: 1,
			address: account.address,
			kdf: {
				name: "scrypt",
				salt: salt.toString("base64"),
				N: 32768,
				r: 8,
				p: 1,
			},
			crypto: {
				iv: iv.toString("base64"),
				authTag: cipher.getAuthTag().toString("base64"),
				ciphertext: ciphertext.toString("base64"),
			},
		};
		await mkdir(join(home, "keystore"), { recursive: true, mode: 0o700 });
		await checkDirectory(home);
		await checkDirectory(join(home, "keystore"));
		const file = await open(pathFor(home, account.address), "wx", 0o600);
		try {
			await file.writeFile(`${JSON.stringify(value, null, 2)}\n`);
			await file.sync();
		} finally {
			await file.close();
		}
		return account.address;
	} finally {
		key.fill(0);
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
): Promise<Signer> {
	const value = await readStore(home, address);
	const key = await derive(
		await read(`Passphrase for ${value.address}: `),
		base64(value.kdf.salt, 32),
	);
	let plaintext: Buffer | undefined;
	try {
		const cipher = createDecipheriv(
			"aes-256-gcm",
			key,
			base64(value.crypto.iv, 12),
		);
		cipher.setAAD(
			Buffer.from(`mstack-keystore-v1:${value.address.toLowerCase()}`),
		);
		cipher.setAuthTag(base64(value.crypto.authTag, 16));
		plaintext = cipher.update(base64(value.crypto.ciphertext, 32));
		// Keep a reference before authentication, so failure also clears the bytes.
		cipher.final().fill(0);
		let account: ReturnType<typeof privateKeyToAccount> | undefined =
			privateKeyToAccount(`0x${plaintext.toString("hex")}`);
		if (account.address !== getAddress(address))
			throw new Error("Address mismatch");
		const owner = account.address;
		const take = () => {
			if (!account)
				throw new Error("Keystore signer is closed or already used");
			const active = account;
			account = undefined;
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
