import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashTypedData, keccak256, stringToHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
	contentHash,
	type PreflightResult,
	type Proposal,
	type ProposalInput,
	ProposalStore,
} from "../src/index.ts";

const home = await mkdtemp(join(tmpdir(), "mstack-proposals-test-"));
afterAll(() => rm(home, { recursive: true, force: true }));
const account = privateKeyToAccount(generatePrivateKey());
let sequence = 0;
async function fixture(kind: ProposalInput["kind"] = "sign-text") {
	const directory = join(home, String(sequence++));
	let now = 1_787_555_739_000;
	const store = new ProposalStore(directory, () => now);
	const typedData = {
		domain: { name: "W7", version: "1", chainId: 97 },
		types: { Consent: [{ name: "value", type: "uint256" }] },
		primaryType: "Consent",
		message: { value: "42" },
	};
	const p = await store.stage({
		kind,
		owner: account.address,
		purpose: "Test Proposal",
		signing:
			kind === "sign-text"
				? {
						type: "text",
						message: "Close arbitrage task: t1 timestamp=1787555739",
					}
				: { type: "typed", typedData },
		submit: {
			base: "http://127.0.0.1:1234",
			route: "/api/arbitrage/close",
			body: { taskId: "t1", timestamp: now / 1000 },
			signatureField: "signature",
		},
		preflightPlan: {
			checks: [
				{
					route: "/api/arbitrage/task",
					params: { taskId: "t1", owner: account.address },
					assertions: [{ path: ["owner"], equals: account.address }],
				},
			],
		},
	});
	const preview = async (): Promise<PreflightResult> => ({
		ok: true,
		checkedAt: now,
		checks: [{ route: "/api/arbitrage/task", ok: true }],
	});
	let signatures = 0,
		submissions = 0,
		connections = 0;
	const options = {
		policy: "manual" as const,
		owner: account.address,
		connect: async () => {
			connections++;
			return {
				address: async () => account.address,
				signMessage: async (
					args: Parameters<typeof account.signMessage>[0],
				) => {
					signatures++;
					return account.signMessage(args);
				},
				signTypedData: async (
					args: Parameters<typeof account.signTypedData>[0],
				) => {
					signatures++;
					return account.signTypedData(args);
				},
			};
		},
		display: (_p: Proposal) => {},
		submit: async () => {
			submissions++;
			return { taskId: "fake-1" };
		},
	};
	return {
		store,
		p,
		directory,
		preview,
		options,
		advance: (ms: number) => {
			now += ms;
		},
		counts: () => ({ signatures, submissions, connections }),
	};
}
test("counter ids, modes, exact text digest, and immutable intent", async () => {
	const f = await fixture();
	expect(f.p.id).toBe("p-1");
	expect(f.p.expiresAt - f.p.createdAt).toBe(300_000);
	expect(f.p.digest).toBe(
		keccak256(
			stringToHex(f.p.signing.type === "text" ? f.p.signing.message : ""),
		),
	);
	expect(
		(await stat(join(f.directory, "proposals", "p-1.json"))).mode & 0o777,
	).toBe(0o600);
	const second = await f.store.stage({
		kind: f.p.kind,
		owner: f.p.owner,
		purpose: f.p.purpose,
		signing: f.p.signing,
		submit: f.p.submit,
		preflightPlan: f.p.preflightPlan,
	});
	expect(second.id).toBe("p-2");
	expect((await f.store.list()).map((p) => p.id)).toEqual(["p-1", "p-2"]);
	const changed = {
		...f.p,
		submit: { ...f.p.submit, body: { ...f.p.submit.body, taskId: "evil" } },
	};
	changed.contentHash = contentHash(changed);
	await writeFile(
		join(f.directory, "proposals", "p-1.json"),
		JSON.stringify(changed),
	);
	await expect(f.store.get("p-1")).rejects.toThrow("intent was changed");
	await expect(f.store.get("../p-1")).rejects.toThrow("Invalid Proposal id");
});
test.each(["sign-text", "sign-typed", "venue-submit"] as const)(
	"%s signs once, stores answer, and does not claim execution confirmed",
	async (kind) => {
		const f = await fixture(kind);
		if (f.p.signing.type === "typed")
			expect(f.p.digest).toBe(hashTypedData(f.p.signing.typedData));
		let previews = 0;
		await f.store.preview(f.p.id, async () => {
			previews++;
			return f.preview();
		});
		await f.store.preview(f.p.id, async () => {
			previews++;
			return f.preview();
		});
		expect(previews).toBe(2);
		expect(f.counts().signatures).toBe(0);
		const displayed: Proposal[] = [];
		const result = await f.store.sign(f.p.id, {
			...f.options,
			display: (p) => displayed.push(p),
			submit: async (p, body) => {
				expect(p.signature).toBeDefined();
				expect(body).toEqual({
					...f.p.submit.body,
					signature: p.signature as string,
				});
				return f.options.submit();
			},
		});
		expect(displayed[0].signing).toEqual(f.p.signing);
		expect(displayed[0].digest).toBe(f.p.digest);
		expect(result.status).toBe("submitted");
		expect(result.endedAt).toBe(f.p.createdAt);
		expect((await f.store.get(f.p.id)).endedAt).toBe(result.endedAt);
		expect(result.answer).toEqual({ taskId: "fake-1" });
		await expect(f.store.sign(f.p.id, f.options)).rejects.toThrow(
			"already used",
		);
		expect(f.counts()).toEqual({
			signatures: 1,
			submissions: 1,
			connections: 1,
		});
		// Restoring a pre-sign JSON file still cannot defeat the durable attempt marker.
		await writeFile(
			join(f.directory, "proposals", `${f.p.id}.json`),
			JSON.stringify({
				...f.p,
				status: "awaiting-signature",
				preflight: await f.preview(),
			}),
		);
		await expect(f.store.sign(f.p.id, f.options)).rejects.toThrow(
			"already used",
		);
	},
);
test("preview is mandatory; locked policy and owner mismatch never unlock", async () => {
	const f = await fixture();
	await expect(f.store.sign(f.p.id, f.options)).rejects.toThrow(
		"Run mob preview",
	);
	await f.store.preview(f.p.id, f.preview);
	await expect(
		f.store.sign(f.p.id, { ...f.options, policy: "locked" }),
	).rejects.toThrow("locked");
	await expect(
		f.store.sign(f.p.id, {
			...f.options,
			owner: privateKeyToAccount(generatePrivateKey()).address,
		}),
	).rejects.toThrow("owner");
	expect(f.counts()).toEqual({ signatures: 0, submissions: 0, connections: 0 });
});
test("signer address mismatch and forged signatures never submit", async () => {
	const f = await fixture();
	await f.store.preview(f.p.id, f.preview);
	const other = privateKeyToAccount(generatePrivateKey());
	await expect(
		f.store.sign(f.p.id, {
			...f.options,
			connect: async () => ({ ...other, address: async () => other.address }),
		}),
	).rejects.toThrow("signer address");
	expect(f.counts().submissions).toBe(0);
	await expect(
		f.store.sign(f.p.id, {
			...f.options,
			connect: async () => ({
				address: async () => account.address,
				signMessage: other.signMessage,
				signTypedData: other.signTypedData,
			}),
		}),
	).rejects.toThrow("does not recover");
	expect((await f.store.get(f.p.id)).status).toBe("interrupted");
	await expect(f.store.sign(f.p.id, f.options)).rejects.toThrow("already used");
});
test.each([299_999, 300_000, 300_001])(
	"expiry boundary at %d ms",
	async (elapsed) => {
		const f = await fixture();
		await f.store.preview(f.p.id, f.preview);
		f.advance(elapsed);
		if (elapsed < 300_000) {
			await f.store.sign(f.p.id, f.options);
			expect(f.counts().signatures).toBe(1);
		} else {
			await expect(f.store.sign(f.p.id, f.options)).rejects.toThrow("expired");
			expect(f.counts().signatures).toBe(0);
			expect((await f.store.get(f.p.id)).status).toBe("expired");
		}
	},
);
test("expiry during TTY unlock blocks signing", async () => {
	const f = await fixture();
	await f.store.preview(f.p.id, f.preview);
	await expect(
		f.store.sign(f.p.id, {
			...f.options,
			connect: async () => {
				f.advance(300_000);
				return f.options.connect();
			},
		}),
	).rejects.toThrow("expired");
	expect(f.counts().signatures).toBe(0);
});
test("expiry while signer is waiting burns the attempt and never submits", async () => {
	const f = await fixture();
	await f.store.preview(f.p.id, f.preview);
	await expect(
		f.store.sign(f.p.id, {
			...f.options,
			connect: async () => {
				const signer = await f.options.connect();
				return {
					...signer,
					signMessage: async (args) => {
						const sig = await signer.signMessage(args);
						f.advance(300_000);
						return sig;
					},
				};
			},
		}),
	).rejects.toThrow("expired while signing");
	expect(f.counts().submissions).toBe(0);
	await expect(f.store.sign(f.p.id, f.options)).rejects.toThrow();
});
test("failed preflight, rejection, and failed submission are terminal", async () => {
	const f = await fixture();
	const rejected = await f.store.preview(f.p.id, async () => ({
		ok: false,
		checkedAt: f.p.createdAt,
		checks: [{ route: "/api/arbitrage/task", ok: false, error: "blocked" }],
	}));
	expect(rejected.status).toBe("rejected");
	expect(rejected.endedAt).toBe(f.p.createdAt);
	await expect(f.store.sign(f.p.id, f.options)).rejects.toThrow();
	const g = await fixture();
	g.advance(1000);
	expect((await g.store.reject(g.p.id)).endedAt).toBe(g.p.createdAt + 1000);
	g.advance(120_000);
	expect((await g.store.reject(g.p.id)).endedAt).toBe(g.p.createdAt + 1000);
	await expect(g.store.preview(g.p.id, g.preview)).rejects.toThrow();
	const h = await fixture();
	await h.store.preview(h.p.id, h.preview);
	await expect(
		h.store.sign(h.p.id, {
			...h.options,
			submit: async () => {
				throw new Error("ambiguous network failure");
			},
		}),
	).rejects.toThrow("ambiguous");
	expect((await h.store.get(h.p.id)).endedAt).toBe(h.p.createdAt);
	await expect(h.store.sign(h.p.id, h.options)).rejects.toThrow();
	expect(h.counts().signatures).toBe(1);
});
test("concurrent signers cannot both prompt or sign", async () => {
	const f = await fixture();
	await f.store.preview(f.p.id, f.preview);
	const result = await Promise.allSettled([
		f.store.sign(f.p.id, f.options),
		new ProposalStore(f.directory, () => f.p.createdAt).sign(f.p.id, f.options),
	]);
	expect(result.filter((x) => x.status === "fulfilled")).toHaveLength(1);
	expect(f.counts().signatures).toBe(1);
});
test("stored message and digest edits are rejected", async () => {
	const f = await fixture();
	const file = join(f.directory, "proposals", `${f.p.id}.json`);
	const raw = JSON.parse(await readFile(file, "utf8"));
	raw.signing.message += " extra";
	await writeFile(file, JSON.stringify(raw));
	await expect(f.store.get(f.p.id)).rejects.toThrow("integrity");
});

test("crossing a second during staging retains the request timestamp and original expiry", async () => {
	const f = await fixture();
	f.advance(1_500);
	const p = await f.store.stage({
		kind: f.p.kind,
		owner: f.p.owner,
		purpose: f.p.purpose,
		signing: f.p.signing,
		submit: f.p.submit,
		preflightPlan: f.p.preflightPlan,
	});
	expect(p.createdAt).toBe(f.p.createdAt);
	expect(p.expiresAt).toBe(f.p.expiresAt);
	expect(p.submit.body.timestamp).toBe(f.p.submit.body.timestamp);
});
test("expiry during preflight persists expired and never allows signing", async () => {
	const f = await fixture();
	await expect(
		f.store.preview(f.p.id, async () => {
			f.advance(300_000);
			return f.preview();
		}),
	).rejects.toThrow("expired");
	expect((await f.store.get(f.p.id)).status).toBe("expired");
	expect(f.counts().signatures).toBe(0);
});

test.each(["dead", "old", "legacy"])(
	"reclaims %s locks, logs once, and preserves attempt markers",
	async (kind) => {
		const { mkdir, utimes } = await import("node:fs/promises");
		const f = await fixture();
		const lock = join(f.directory, "proposals", "p-1.json.lock");
		await mkdir(lock, { mode: 0o700 });
		if (kind === "legacy") await utimes(lock, new Date(0), new Date(0));
		else
			await writeFile(
				join(lock, "owner"),
				JSON.stringify({
					pid: kind === "dead" ? 2147483647 : process.pid,
					started_at: kind === "old" ? Date.now() - 600_001 : Date.now(),
				}),
				{ mode: 0o600 },
			);
		await writeFile(
			join(f.directory, "proposals", "p-1.signature-used"),
			f.p.contentHash,
			{ mode: 0o600 },
		);
		const logs: string[] = [];
		const store = new ProposalStore(
			f.directory,
			() => f.p.createdAt,
			(s) => logs.push(s),
		);
		expect((await store.get("p-1")).status).toBe("interrupted");
		expect((await store.reject("p-1")).status).toBe("rejected");
		expect(logs).toEqual(["Reclaimed stale lock for p-1."]);
		expect(
			await readFile(
				join(f.directory, "proposals", "p-1.signature-used"),
				"utf8",
			),
		).toBe(f.p.contentHash);
		await expect(stat(lock)).rejects.toHaveProperty("code", "ENOENT");
	},
);

test("live lock identifies its pid and time, blocks a second writer with recovery instructions, then releases", async () => {
	const f = await fixture();
	let release!: () => void;
	let entered!: () => void;
	const ready = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const hold = new Promise<void>((resolve) => {
		release = resolve;
	});
	const first = f.store.preview("p-1", async () => {
		entered();
		await hold;
		return f.preview();
	});
	await ready;
	const lock = join(f.directory, "proposals", "p-1.json.lock");
	try {
		const owner = JSON.parse(await readFile(join(lock, "owner"), "utf8"));
		expect(owner.pid).toBe(process.pid);
		expect(owner.started_at).toBeGreaterThan(Date.now() - 5000);
		expect((await stat(join(lock, "owner"))).mode & 0o777).toBe(0o600);
		await expect(f.store.reject("p-1")).rejects.toThrow(
			"another mob process holds p-1; if it crashed, wait a minute and run `mob reject p-1` again",
		);
		await expect(f.store.preview("p-1", f.preview)).rejects.toThrow(
			"another mob process holds p-1; if it crashed, run again in a minute or `mob reject p-1`",
		);
	} finally {
		release();
		await first;
	}
	await expect(stat(lock)).rejects.toHaveProperty("code", "ENOENT");
});

test("read-time expiry does not write state and rejection closes an expired Proposal", async () => {
	const f = await fixture();
	await f.store.preview("p-1", f.preview);
	f.advance(300_000);
	expect((await f.store.list())[0].status).toBe("expired");
	expect(
		JSON.parse(
			await readFile(join(f.directory, "proposals", "p-1.json"), "utf8"),
		).status,
	).toBe("awaiting-signature");
	expect((await f.store.reject("p-1")).status).toBe("rejected");
});

test("cancelling an outstanding signature releases the lock, burns the attempt and rejects late signatures", async () => {
	const f = await fixture();
	await f.store.preview("p-1", f.preview);
	const controller = new AbortController();
	let entered!: () => void;
	const ready = new Promise<void>((resolve) => {
		entered = resolve;
	});
	let release!: () => void;
	const hold = new Promise<void>((resolve) => {
		release = resolve;
	});
	const signing = f.store.sign("p-1", {
		...f.options,
		signal: controller.signal,
		connect: async () => {
			const signer = await f.options.connect();
			return {
				...signer,
				signMessage: async (args) => {
					entered();
					await hold;
					return signer.signMessage(args);
				},
			};
		},
	});
	await ready;
	controller.abort(new Error("cancelled"));
	await expect(signing).rejects.toThrow("cancelled");
	expect((await f.store.get("p-1")).status).toBe("interrupted");
	await expect(
		stat(join(f.directory, "proposals", "p-1.json.lock")),
	).rejects.toHaveProperty("code", "ENOENT");
	await expect(f.store.sign("p-1", f.options)).rejects.toThrow("already used");
	release();
	await Bun.sleep(10);
	expect(f.counts().submissions).toBe(0);
	expect((await f.store.reject("p-1")).status).toBe("rejected");
});
