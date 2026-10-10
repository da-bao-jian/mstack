import { afterAll, expect, test } from "bun:test";
import {
	chmod,
	mkdtemp,
	readFile,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
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
			signature: await signer.signTypedData(typed),
		}),
	).toBe(address);
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
	await expect(createKeystore(home, async () => String(i++))).rejects.toThrow(
		"do not match",
	);
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
