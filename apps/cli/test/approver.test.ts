import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageOpenBody } from "@mstack/mobius-client";
import { ProposalStore } from "@mstack/proposals";
import { importKeystore } from "@mstack/signers";
import { fakeOwnerKey } from "../../../packages/mobius-api/test/fake-api.ts";
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
	expect(await run(["sign", p.id], r.agentRt)).toBe(0);
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
