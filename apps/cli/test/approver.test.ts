import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageOpenBody } from "@mstack/mobius-client";
import { contentHash, digest, ProposalStore } from "@mstack/proposals";
import { importKeystore } from "@mstack/signers";
import { fakeOwnerKey } from "../../../packages/mobius-api/test/fake-api.ts";
import { serializeRecord } from "../../../packages/proposals/src/record.ts";
import { approverStatus, startApprover } from "../src/approver.ts";
import { setConfig } from "../src/config.ts";
import { type Runtime, run } from "../src/run.ts";
import {
	fakeFundingServer,
	loopbackFetch,
} from "./fixtures/fake-funding-server.ts";

const homes: string[] = [];
const stops: (() => Promise<void>)[] = [];
const servers: { stop(): void }[] = [];
afterEach(async () => {
	for (const stop of stops.splice(0)) await stop();
	for (const server of servers.splice(0)) server.stop();
	await Promise.all(
		homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
	);
});

async function setup(clock: () => number = Date.now) {
	const home = await mkdtemp(join(tmpdir(), "mstack-approver-"));
	homes.push(home);
	const password = "approver passphrase";
	const creation = [fakeOwnerKey, password, password];
	const owner = await importKeystore(home, async () => creation.shift() ?? "");
	await setConfig("owner", owner, home);
	await setConfig("signer", "keystore", home);
	await setConfig("policy", "manual", home);
	const staged = stageOpenBody({
		longVenue: "hl",
		longMarket: "xyz:NVDA",
		shortVenue: "aster",
		shortMarket: "USD1:NVDA",
		sizeUsd: 1000,
		longPrice: 123.25,
		shortPrice: 123.5,
		autoClose: false,
		maxSpreadBps: 50,
	});
	const server = fakeFundingServer(owner, staged.body);
	servers.push(server);
	await setConfig("api_base", server.base, home);
	const store = new ProposalStore(home, clock);
	const stage = async () => {
		const p = await store.stage({
			kind: "sign-text",
			owner,
			purpose: "Fake-server open only",
			signing: { type: "text", message: staged.message },
			submit: {
				base: server.base,
				route: "/api/arbitrage/create",
				body: staged.body,
				signatureField: "signature",
			},
			preflightPlan: {
				checks: [
					{
						route: "/api/binding/rebind-check",
						params: { ownerAddress: owner, venue: "hl" },
						assertions: [{ path: ["allowed"], equals: true }],
					},
				],
			},
		});
		await store.preview(p.id, async () => ({
			ok: true,
			checkedAt: clock(),
			checks: [{ route: "/api/binding/rebind-check", ok: true }],
		}));
		return p;
	};
	return { home, owner, password, server, store, stage, staged };
}

function runtimes(home: string) {
	const human: string[] = [];
	const agent: string[] = [];
	const agentErrors: string[] = [];
	// The approver's own terminal.
	const humanRt: Partial<Runtime> = {
		home,
		fetch: loopbackFetch,
		stdinIsTTY: true,
		stdoutIsTTY: true,
		out: (line) => human.push(line),
		err: (line) => human.push(line),
	};
	// The agent's shell: no TTY, no passphrase.
	const agentRt: Partial<Runtime> = {
		home,
		fetch: loopbackFetch,
		stdinIsTTY: false,
		stdoutIsTTY: false,
		out: (line) => agent.push(line),
		err: (line) => agentErrors.push(line),
		readSecret: async () => {
			throw new Error("the agent must never be asked for a passphrase");
		},
	};
	return { human, agent, agentErrors, humanRt, agentRt };
}

test("an agent's mob sign hands the card to the approver, which signs once per approval with one unlock", async () => {
	const t = await setup();
	const r = runtimes(t.home);
	let prompts = 0;
	const decisions: boolean[] = [true, true];
	const cards: string[] = [];
	const handle = await startApprover(
		{ ...r.humanRt, home: t.home },
		{
			confirm: async (card) => {
				cards.push(card);
				return decisions.shift() ?? false;
			},
			read: async () => {
				prompts++;
				return t.password;
			},
			idleMs: 60 * 60 * 1000,
		},
	);
	stops.push(handle.stop);
	expect(prompts).toBe(1); // verified once at start
	expect(await approverStatus(t.home)).toEqual({ running: true });
	const p = await t.stage();
	// The agent's configured signer is keystore and it has no TTY: routed automatically.
	// Signing inside the approver must not touch process signal listeners (Bun
	// drops the native handler on removal, which would break the approver's Ctrl-C).
	const sigints = process.listenerCount("SIGINT");
	const seen: number[] = [];
	expect(
		await run(["sign", p.id], {
			...r.agentRt,
			out: (line) => {
				r.agent.push(line);
				seen.push(process.listenerCount("SIGINT"));
			},
		}),
	).toBe(0);
	expect(seen.length).toBeGreaterThan(0);
	expect(seen.every((count) => count === sigints)).toBe(true);
	expect(r.agent.join("\n")).toContain(
		`Handed ${p.id} to your approver terminal`,
	);
	expect(r.agent.join("\n")).toContain(t.staged.message);
	expect(r.agent.join("\n") + r.agentErrors.join("\n")).not.toContain(
		t.password,
	);
	expect(cards).toHaveLength(1);
	expect(cards[0]).toContain(p.id);
	expect(t.server.writes()).toBe(1);
	expect((await t.store.get(p.id)).status).toBe("submitted");
	expect(prompts).toBe(1); // the cached passphrase covered the signature
	// Explicit backend works too, and a second Proposal needs a second approval.
	const q = await t.stage();
	expect(await run(["sign", q.id, "--with", "approver"], r.agentRt)).toBe(0);
	expect(cards).toHaveLength(2);
	expect(t.server.writes()).toBe(2);
	// A declined card signs nothing and leaves the Proposal signable.
	const d = await t.stage();
	expect(await run(["sign", d.id, "--with", "approver"], r.agentRt)).toBe(1);
	expect(r.agentErrors.join("\n")).toContain(
		`${d.id} was declined in the approver`,
	);
	expect(t.server.writes()).toBe(2);
	expect((await t.store.get(d.id)).status).toBe("awaiting-signature");
	// The human's terminal saw every card and the signing output.
	expect(r.human.join("\n")).toContain(`Request to sign ${p.id}`);
	expect(r.human.join("\n")).toContain("Approver running for");
});

test("without an approver the agent cannot use the keystore, and a wrong token is refused", async () => {
	const t = await setup();
	const r = runtimes(t.home);
	expect(await approverStatus(t.home)).toEqual({ running: false });
	const p = await t.stage();
	expect(await run(["sign", p.id, "--with", "approver"], r.agentRt)).toBe(1);
	expect(r.agentErrors.join("\n")).toContain("no approver is running");
	expect(t.server.writes()).toBe(0);
	const handle = await startApprover(
		{ ...r.humanRt, home: t.home },
		{
			confirm: async () => true,
			read: async () => t.password,
		},
	);
	stops.push(handle.stop);
	// Overwrite the token the client reads: the approver must refuse it.
	await Bun.write(join(t.home, "approver.token"), "not-the-token\n");
	expect(await run(["sign", p.id, "--with", "approver"], r.agentRt)).toBe(1);
	expect(r.agentErrors.join("\n")).toContain("approver token mismatch");
	expect(t.server.writes()).toBe(0);
});

test("hello reports the approver and the idle window re-asks for the passphrase", async () => {
	const t = await setup();
	const r = runtimes(t.home);
	let prompts = 0;
	// A one-millisecond idle window: the next request must unlock again.
	const handle = await startApprover(
		{ ...r.humanRt, home: t.home },
		{
			confirm: async () => true,
			read: async () => {
				prompts++;
				return t.password;
			},
			idleMs: 1,
		},
	);
	stops.push(handle.stop);
	const hello: string[] = [];
	expect(
		await run(["hello", "--json", "--offline"], {
			...r.agentRt,
			out: (line) => hello.push(line),
		}),
	).toBe(0);
	expect(JSON.parse(hello.join("\n")).approver).toEqual({ running: true });
	const p = await t.stage();
	await new Promise((resolve) => setTimeout(resolve, 5));
	expect(await run(["sign", p.id, "--with", "approver"], r.agentRt)).toBe(0);
	expect(prompts).toBe(2); // startup plus one re-unlock after the idle window
	await handle.stop();
	stops.length = 0;
	expect(await approverStatus(t.home)).toEqual({ running: false });
});

test("the approver renders the card and its pin from one read of the record", async () => {
	const t = await setup();
	const r = runtimes(t.home);
	const p = await t.stage();
	const original = ProposalStore.prototype.get;
	let reads = 0;
	let readsAtCard = -1;
	ProposalStore.prototype.get = async function (
		this: ProposalStore,
		...args: Parameters<ProposalStore["get"]>
	) {
		reads++;
		return original.apply(this, args);
	};
	try {
		const handle = await startApprover(
			{ ...r.humanRt, home: t.home },
			{
				confirm: async (card) => {
					readsAtCard = reads;
					expect(card).toContain(p.id);
					return false;
				},
				read: async () => t.password,
			},
		);
		stops.push(handle.stop);
		expect(await run(["sign", p.id], r.agentRt)).toBe(1);
	} finally {
		ProposalStore.prototype.get = original;
	}
	// A second read between the pin and the card would let a swap slip in.
	expect(readsAtCard).toBe(1);
});

test("the approver pins the card: a record swapped after the human saw it is never signed", async () => {
	const t = await setup();
	const r = runtimes(t.home);
	const p = await t.stage();
	const handle = await startApprover(
		{ ...r.humanRt, home: t.home },
		{
			confirm: async () => {
				// A same-user process rewrites the staged bytes between card and y.
				const stored = await t.store.get(p.id);
				const swapped = {
					...stored,
					signing: {
						type: "text" as const,
						message: "Something else entirely",
					},
				};
				swapped.digest = digest(swapped.signing);
				swapped.contentHash = contentHash(swapped);
				await Bun.write(
					join(t.home, "proposals", `${p.id}.intent`),
					`${swapped.contentHash}\n`,
				);
				await Bun.write(
					join(t.home, "proposals", `${p.id}.json`),
					serializeRecord(swapped),
				);
				return true;
			},
			read: async () => t.password,
		},
	);
	stops.push(handle.stop);
	expect(await run(["sign", p.id], r.agentRt)).toBe(1);
	expect(r.agentErrors.join("\n")).toContain(
		`${p.id} changed after it was shown; nothing was signed`,
	);
	expect(t.server.writes()).toBe(0);
	expect((await t.store.get(p.id)).status).toBe("awaiting-signature");
});

test("a request that fails inside the approver reports and never wedges the next one", async () => {
	const t = await setup();
	const r = runtimes(t.home);
	let calls = 0;
	const handle = await startApprover(
		{ ...r.humanRt, home: t.home },
		{
			confirm: async () => {
				if (++calls === 1) throw new Error("terminal went away");
				return true;
			},
			read: async () => t.password,
		},
	);
	stops.push(handle.stop);
	const p = await t.stage();
	expect(await run(["sign", p.id], r.agentRt)).toBe(1);
	expect(r.agentErrors.join("\n")).toContain(
		"approver request failed: terminal went away",
	);
	expect(t.server.writes()).toBe(0);
	// The queue is still alive: the next request is served and signed.
	expect(await run(["sign", p.id], r.agentRt)).toBe(0);
	expect(t.server.writes()).toBe(1);
	expect(r.human.join("\n")).toContain("terminal went away");
});

test("a second approver on the same home is refused, and mob approver reads the passphrase from the terminal by default", async () => {
	const t = await setup();
	const r = runtimes(t.home);
	const handle = await startApprover(
		{ ...r.humanRt, home: t.home },
		{ confirm: async () => true, read: async () => t.password },
	);
	stops.push(handle.stop);
	await expect(
		startApprover(
			{ ...r.humanRt, home: t.home },
			{ confirm: async () => true, read: async () => t.password },
		),
	).rejects.toThrow("An approver is already running for this home");
	await handle.stop();
	stops.length = 0;
	// The command no longer demands an injected reader: with none supplied it
	// falls back to the controlling terminal, so the failure here is the
	// missing keystore for a fresh owner, not the old reader gate.
	await rm(join(t.home, "keystore"), { recursive: true, force: true });
	const errors: string[] = [];
	expect(
		await run(["approver"], {
			home: t.home,
			fetch: loopbackFetch,
			stdinIsTTY: true,
			stdoutIsTTY: true,
			out: () => {},
			err: (line) => errors.push(line),
		}),
	).toBe(1);
	expect(errors.join("\n")).not.toContain(
		"needs a terminal to read the passphrase",
	);
	expect(errors.join("\n")).not.toContain("needs your own terminal");
});

test("a human with a TTY signs locally while an approver runs, and the requester leaving withdraws the card", async () => {
	const t = await setup();
	const r = runtimes(t.home);
	let confirms = 0;
	let withdrawnSeen = false;
	const handle = await startApprover(
		{ ...r.humanRt, home: t.home },
		{
			confirm: (_card, withdrawn) =>
				new Promise((resolve) => {
					confirms++;
					// The human types y only after the requester has gone.
					withdrawn.addEventListener("abort", () => {
						withdrawnSeen = true;
						resolve(true);
					});
				}),
			read: async () => t.password,
		},
	);
	stops.push(handle.stop);
	// A TTY caller with the keystore signs in place; no card reaches the approver.
	const p = await t.stage();
	const local: string[] = [];
	expect(
		await run(["sign", p.id], {
			...r.agentRt,
			stdinIsTTY: true,
			readSecret: async () => t.password,
			out: (line) => local.push(line),
		}),
	).toBe(0);
	expect(confirms).toBe(0);
	expect(t.server.writes()).toBe(1);
	// An agent hands over a card and disconnects before the answer: nothing signs.
	const q = await t.stage();
	const token = (await readFile(join(t.home, "approver.token"), "utf8")).trim();
	const socket = await Bun.connect({
		unix: join(t.home, "approver.sock"),
		socket: {
			open(socket) {
				socket.write(`${JSON.stringify({ token, id: q.id })}\n`);
			},
			data() {},
		},
	});
	while (confirms < 1) await new Promise((resolve) => setTimeout(resolve, 5));
	socket.end();
	while (!r.human.some((line) => line.startsWith(`Withdrawn ${q.id}`)))
		await new Promise((resolve) => setTimeout(resolve, 5));
	expect(withdrawnSeen).toBe(true);
	expect(t.server.writes()).toBe(1);
	expect((await t.store.get(q.id)).status).toBe("awaiting-signature");
});

test("a mistyped passphrase after the idle window is not cached; the next card asks again", async () => {
	const t = await setup();
	const r = runtimes(t.home);
	const typed = [t.password, "not the passphrase", t.password];
	let prompts = 0;
	const handle = await startApprover(
		{ ...r.humanRt, home: t.home },
		{
			confirm: async () => true,
			read: async () => {
				prompts++;
				return typed.shift() ?? "";
			},
			idleMs: 1,
		},
	);
	stops.push(handle.stop);
	const p = await t.stage();
	await new Promise((resolve) => setTimeout(resolve, 5));
	expect(await run(["sign", p.id, "--with", "approver"], r.agentRt)).toBe(1);
	expect(prompts).toBe(2);
	expect(t.server.writes()).toBe(0);
	await new Promise((resolve) => setTimeout(resolve, 5));
	expect(await run(["sign", p.id, "--with", "approver"], r.agentRt)).toBe(0);
	expect(prompts).toBe(3);
	expect(t.server.writes()).toBe(1);
});
