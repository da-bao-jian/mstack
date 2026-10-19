import { afterAll, expect, test } from "bun:test";
import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	scryptSync,
} from "node:crypto";
import {
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type Hex,
	recoverMessageAddress,
	recoverTypedDataAddress,
	type TypedDataDefinition,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
	createKeystore,
	importKeystore,
	listKeystores,
	unlockKeystore,
} from "../src/index.ts";

const home = await mkdtemp(join(tmpdir(), "mstack-keystore-test-"));
afterAll(() => rm(home, { recursive: true, force: true }));
const password = crypto.randomUUID();
const secret = async () => password;
test("create encrypts a new key in a 0600 file and signs text and typed data", async () => {
	const prompts: string[] = [];
	const address = await createKeystore(home, async (prompt) => {
		prompts.push(prompt);
		return password;
	});
	expect(prompts).toHaveLength(2);
	const file = join(home, "keystore", `${address.toLowerCase()}.json`);
	expect((await stat(file)).mode & 0o777).toBe(0o600);
	const raw = await readFile(file, "utf8");
	expect(raw).not.toContain(password);
	const value = JSON.parse(raw);
	expect(value.version).toBe(2);
	expect(value.kdf).toMatchObject({ name: "scrypt", N: 131072, r: 8, p: 1 });
	expect(Buffer.from(value.kdf.salt, "base64")).toHaveLength(32);
	expect(Object.keys(value.crypto).sort()).toEqual([
		"authTag",
		"ciphertext",
		"iv",
	]);
	expect(Buffer.from(value.crypto.iv, "base64")).toHaveLength(12);
	expect(Buffer.from(value.crypto.authTag, "base64")).toHaveLength(16);
	expect(await listKeystores(home)).toContain(address);
	const signer = await unlockKeystore(home, address, secret);
	expect(await signer.address()).toBe(address);
	const message = "Exact message 1e-7";
	expect(
		await recoverMessageAddress({
			message,
			signature: await signer.signMessage({ message }),
		}),
	).toBe(address);
	const typed: TypedDataDefinition = {
		domain: { name: "W7", version: "1", chainId: 97 },
		types: { Permit: [{ name: "value", type: "uint256" }] },
		primaryType: "Permit",
		message: { value: "1000000000000000000" },
	};
	expect(
		await recoverTypedDataAddress({
			...typed,
			signature: await (
				await unlockKeystore(home, address, secret)
			).signTypedData(typed),
		}),
	).toBe(address);
	await expect(signer.signMessage({ message })).rejects.toThrow("already used");
	const closed = await unlockKeystore(home, address, secret);
	await closed.close?.();
	await expect(closed.signMessage({ message })).rejects.toThrow("closed");
	await expect(
		unlockKeystore(home, address, async () => "wrong"),
	).rejects.toThrow("Cannot unlock");
	const tampered = {
		...value,
		crypto: {
			...value.crypto,
			ciphertext: Buffer.alloc(32).toString("base64"),
		},
	};
	await writeFile(file, JSON.stringify(tampered));
	await expect(unlockKeystore(home, address, secret)).rejects.toThrow(
		"Cannot unlock",
	);
	await writeFile(file, raw);
	await chmod(file, 0o644);
	await expect(unlockKeystore(home, address, secret)).rejects.toThrow("0600");
	await chmod(file, 0o600);
	await writeFile(
		file,
		JSON.stringify({ ...value, kdf: { ...value.kdf, N: 1 } }),
	);
	let promptsAfterTampering = 0;
	await expect(
		unlockKeystore(home, address, async () => {
			promptsAfterTampering++;
			return password;
		}),
	).rejects.toThrow("Invalid keystore metadata");
	expect(promptsAfterTampering).toBe(0);
	await writeFile(file, raw);
	await chmod(join(home, "keystore"), 0o755);
	await expect(unlockKeystore(home, address, secret)).rejects.toThrow("0700");
	await chmod(join(home, "keystore"), 0o700);
});
test("import takes the key only through the reader, never stores plaintext, refuses overwrite", async () => {
	const key = generatePrivateKey();
	const expected = privateKeyToAccount(key).address;
	const prompts: string[] = [];
	const reader = async (prompt: string) => {
		prompts.push(prompt);
		return prompt.startsWith("Private") ? key : password;
	};
	expect(await importKeystore(home, reader)).toBe(expected);
	expect(prompts).toHaveLength(3);
	const raw = await readFile(
		join(home, "keystore", `${expected.toLowerCase()}.json`),
		"utf8",
	);
	expect(raw).not.toContain(key.slice(2));
	expect(raw).not.toContain(password);
	await expect(importKeystore(home, reader)).rejects.toThrow();
	expect(await unlockKeystore(home, expected, secret)).toBeDefined();
});
test("invalid key and mismatched confirmation fail without writing", async () => {
	await expect(
		importKeystore(home, async () => "invalid secret"),
	).rejects.toThrow("Invalid private key");
	let i = 0;
	await expect(
		createKeystore(home, async () => `long passphrase ${i++}`),
	).rejects.toThrow("do not match");
});
test("a new or imported keystore needs a passphrase of at least 12 characters", async () => {
	const isolated = await mkdtemp(join(tmpdir(), "mstack-keystore-short-"));
	try {
		for (const short of ["", "short", "elevenchars", "ünïcödé-ñ1"]) {
			await expect(createKeystore(isolated, async () => short)).rejects.toThrow(
				"at least 12 characters",
			);
			const inputs = [generatePrivateKey(), short, short];
			await expect(
				importKeystore(isolated, async () => inputs.shift() ?? ""),
			).rejects.toThrow("at least 12 characters");
		}
		expect(await listKeystores(isolated)).toEqual([]);
		expect(await createKeystore(isolated, async () => "twelve chars")).toMatch(
			/^0x/,
		);
	} finally {
		await rm(isolated, { recursive: true, force: true });
	}
});

/** A keystore file exactly as version 1 wrote it (scrypt N = 2^15). */
function versionOne(privateKey: Hex, passphrase: string) {
	const address = privateKeyToAccount(privateKey).address;
	const salt = randomBytes(32),
		iv = randomBytes(12);
	const key = scryptSync(passphrase, salt, 32, {
		N: 32768,
		r: 8,
		p: 1,
		maxmem: 128 * 1024 * 1024,
	});
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	cipher.setAAD(Buffer.from(`mstack-keystore-v1:${address.toLowerCase()}`));
	const ciphertext = Buffer.concat([
		cipher.update(Buffer.from(privateKey.slice(2), "hex")),
		cipher.final(),
	]);
	return {
		address,
		value: {
			version: 1,
			address,
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
		},
	};
}

test("a version 1 keystore still unlocks and is rewritten atomically as version 2", async () => {
	const isolated = await mkdtemp(join(tmpdir(), "mstack-keystore-v1-"));
	try {
		const privateKey = generatePrivateKey();
		const { address, value } = versionOne(privateKey, password);
		await mkdir(join(isolated, "keystore"), { recursive: true, mode: 0o700 });
		await chmod(isolated, 0o700);
		const file = join(isolated, "keystore", `${address.toLowerCase()}.json`);
		await writeFile(file, JSON.stringify(value), { mode: 0o600 });
		await expect(
			unlockKeystore(isolated, address, async () => "wrong passphrase"),
		).rejects.toThrow("Cannot unlock");
		expect(JSON.parse(await readFile(file, "utf8")).version).toBe(1);
		const signer = await unlockKeystore(isolated, address, secret);
		const message = "v1 upgrade";
		expect(
			await recoverMessageAddress({
				message,
				signature: await signer.signMessage({ message }),
			}),
		).toBe(address);
		const upgraded = JSON.parse(await readFile(file, "utf8"));
		expect(upgraded.version).toBe(2);
		expect(upgraded.kdf).toMatchObject({ N: 131072, r: 8, p: 1 });
		expect(upgraded.kdf.salt).not.toBe(value.kdf.salt);
		expect((await stat(file)).mode & 0o777).toBe(0o600);
		expect(await readdir(join(isolated, "keystore"))).toEqual([
			`${address.toLowerCase()}.json`,
		]);
		expect(JSON.stringify(upgraded)).not.toContain(privateKey.slice(2));
		expect(await listKeystores(isolated)).toEqual([address]);
		expect(
			await (await unlockKeystore(isolated, address, secret)).address(),
		).toBe(address);
	} finally {
		await rm(isolated, { recursive: true, force: true });
	}
});

test("version 2 binds the format and every KDF parameter into the associated data", async () => {
	const isolated = await mkdtemp(join(tmpdir(), "mstack-keystore-v2-"));
	try {
		const address = await createKeystore(isolated, secret);
		const file = join(isolated, "keystore", `${address.toLowerCase()}.json`);
		const raw = await readFile(file, "utf8");
		const value = JSON.parse(raw);
		const key = scryptSync(
			password,
			Buffer.from(value.kdf.salt, "base64"),
			32,
			{
				N: 131072,
				r: 8,
				p: 1,
				maxmem: 256 * 1024 * 1024,
			},
		);
		const open = (aad: string) => {
			const cipher = createDecipheriv(
				"aes-256-gcm",
				key,
				Buffer.from(value.crypto.iv, "base64"),
			);
			cipher.setAAD(Buffer.from(aad));
			cipher.setAuthTag(Buffer.from(value.crypto.authTag, "base64"));
			cipher.update(Buffer.from(value.crypto.ciphertext, "base64"));
			cipher.final();
		};
		const lower = address.toLowerCase();
		open(
			`mstack-keystore-v2:${lower}:scrypt:N=131072:r=8:p=1:salt=${value.kdf.salt}`,
		);
		for (const aad of [
			`mstack-keystore-v1:${lower}`,
			`mstack-keystore-v2:${lower}`,
			`mstack-keystore-v2:${lower}:scrypt:N=32768:r=8:p=1:salt=${value.kdf.salt}`,
		])
			expect(() => open(aad)).toThrow();
		for (const kdf of [
			{ ...value.kdf, N: 32768 },
			{ ...value.kdf, N: 262144 },
			{ ...value.kdf, r: 16 },
			{ ...value.kdf, p: 2 },
		]) {
			await writeFile(file, JSON.stringify({ ...value, kdf }));
			await expect(unlockKeystore(isolated, address, secret)).rejects.toThrow(
				"Invalid keystore metadata",
			);
		}
		await writeFile(
			file,
			JSON.stringify({
				...value,
				kdf: { ...value.kdf, salt: randomBytes(32).toString("base64") },
			}),
		);
		await expect(unlockKeystore(isolated, address, secret)).rejects.toThrow(
			"Cannot unlock",
		);
		await writeFile(file, JSON.stringify({ ...value, version: 1 }));
		await expect(unlockKeystore(isolated, address, secret)).rejects.toThrow(
			"Invalid keystore metadata",
		);
		await writeFile(file, raw);
		expect(
			await (await unlockKeystore(isolated, address, secret)).address(),
		).toBe(address);
	} finally {
		await rm(isolated, { recursive: true, force: true });
	}
});
test("keystore refuses symlinks", async () => {
	const isolated = await mkdtemp(join(tmpdir(), "mstack-keystore-link-"));
	try {
		const address = await createKeystore(isolated, secret);
		const file = join(isolated, "keystore", `${address.toLowerCase()}.json`);
		const raw = await readFile(file);
		await rm(file);
		await writeFile(join(isolated, "target"), raw, { mode: 0o600 });
		await symlink(join(isolated, "target"), file);
		await expect(unlockKeystore(isolated, address, secret)).rejects.toThrow();
	} finally {
		await rm(isolated, { recursive: true, force: true });
	}
});
