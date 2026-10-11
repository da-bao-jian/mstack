import { expect, test } from "bun:test";
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
import { keccak256, stringToHex } from "viem";
import { seeded } from "../../test-seed.ts";
import { digest, type ProposalInput, ProposalStore } from "../src/index.ts";

const now = 1_791_635_200_000;
const input: ProposalInput = {
	kind: "sign-text",
	owner: "0x0000000000000000000000000000000000000001",
	purpose: "Fuzz close",
	signing: {
		type: "text",
		message: "Close arbitrage task: task-17 timestamp=1791635200",
	},
	submit: {
		base: "https://funding.mob.exchange",
		route: "/api/arbitrage/close",
		body: { taskId: "task-17", timestamp: now / 1000 },
		signatureField: "signature",
	},
	preflightPlan: {
		checks: [
			{ route: "staged", name: "fixture", detail: "Recorded fixture only" },
		],
	},
};

test("seed 0x1702: byte flips fail with file and field; no partially loaded list", async () => {
	const home = await mkdtemp(join(tmpdir(), "mstack-byte-fuzz-"));
	try {
		const store = new ProposalStore(home, () => now);
		const p = await store.stage(input);
		await store.stage(input);
		const path = join(home, "proposals", `${p.id}.json`);
		const original = await readFile(path);
		const hash = keccak256(`0x${original.toString("hex")}`);
		const random = seeded(0x1702);
		for (let i = 0; i < 256; i++) {
			const bytes = Buffer.from(original);
			bytes[random(bytes.length)] ^= 1 << random(8);
			expect(keccak256(`0x${bytes.toString("hex")}`)).not.toBe(hash);
			await writeFile(path, bytes);
			for (const operation of [() => store.get(p.id), () => store.list()]) {
				let error: unknown;
				try {
					await operation();
				} catch (caught) {
					error = caught;
				}
				expect(error).toBeInstanceOf(Error);
				expect((error as Error).message).toContain(`${path}:`);
				expect((error as Error).message).toMatch(
					/JSON|Proposal|recordHash|owner|signing|submit|preflight|purpose|kind|Signature|Text/,
				);
			}
		}
		await writeFile(path, original);
		expect(await store.get(p.id)).toEqual(p);
		// Only changes to signed bytes change the protocol digest. Audit fields use recordHash.
		const message = input.signing.type === "text" ? input.signing.message : "";
		for (let i = 0; i < message.length; i++) {
			const changed =
				message.slice(0, i) +
				String.fromCharCode(message.charCodeAt(i) ^ 1) +
				message.slice(i + 1);
			expect(digest({ type: "text", message: changed })).not.toBe(
				keccak256(stringToHex(message)),
			);
		}
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("private Proposal directories, files, markers and locks fail closed", async () => {
	const home = await mkdtemp(join(tmpdir(), "mstack-permission-test-"));
	try {
		const store = new ProposalStore(home, () => now);
		const p = await store.stage(input);
		for (const folder of [home, join(home, "proposals")])
			expect((await stat(folder)).mode & 0o777).toBe(0o700);
		for (const file of ["counter", "p-1.json", "p-1.intent"])
			expect((await stat(join(home, "proposals", file))).mode & 0o777).toBe(
				0o600,
			);
		await store.preview(p.id, async () => ({
			ok: true,
			checkedAt: now,
			checks: [{ route: "staged", name: "fixture", ok: true }],
		}));
		await expect(
			store.sign(p.id, {
				policy: "manual",
				owner: input.owner,
				display() {},
				connect: async () => ({
					address: async () => input.owner,
					async signMessage() {
						const marker = join(home, "proposals", "p-1.signature-used");
						expect((await stat(marker)).mode & 0o777).toBe(0o600);
						expect((await readFile(marker, "utf8")).trim()).toBe(p.contentHash);
						expect(
							(await stat(join(home, "proposals", "p-1.json.lock"))).mode &
								0o777,
						).toBe(0o700);
						throw new Error("intentional signer refusal after durable marker");
					},
					async signTypedData() {
						throw new Error("unexpected");
					},
				}),
				submit: async () => {
					throw new Error("must not submit");
				},
			}),
		).rejects.toThrow("intentional signer refusal");
		await chmod(join(home, "proposals", "p-1.json"), 0o644);
		await expect(store.get(p.id)).rejects.toThrow("p-1.json: file");
		await chmod(join(home, "proposals", "p-1.json"), 0o600);
		await chmod(join(home, "proposals"), 0o755);
		await expect(store.get(p.id)).rejects.toThrow("0700");
		await chmod(join(home, "proposals"), 0o700);
		await symlink(home, join(home, "proposals", "p-1.json.lock"));
		await expect(store.reject(p.id)).rejects.toThrow("0700");
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
