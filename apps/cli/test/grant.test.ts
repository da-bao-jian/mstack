import { afterEach, expect, test } from "bun:test";
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAgentGrantMessage } from "@mstack/mobius-client";
import { ProposalStore } from "@mstack/proposals";
import { importKeystore } from "@mstack/signers";
import { verifyMessage } from "viem";
import { fakeOwnerKey } from "../../../packages/mobius-api/test/fake-api.ts";
import { setConfig } from "../src/config.ts";
import { agentKey, grantCommand } from "../src/grant-command.ts";
import { run } from "../src/run.ts";
import { loopbackFetch } from "./fixtures/fake-funding-server.ts";

const homes: string[] = [];
const servers: { stop(): void }[] = [];
afterEach(async () => {
	for (const server of servers.splice(0)) server.stop();
	await Promise.all(
		homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
	);
});

/** A fake MoB API implementing the proposed agent-grant contract. */
function fakeGrantServer(
	owner: string,
	options: { supported: boolean; answerAgent?: string },
) {
	const grants: Record<string, unknown>[] = [];
	const revoked: string[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(req) {
			const url = new URL(req.url);
			if (!options.supported || !url.pathname.startsWith("/api/agent-grants"))
				return Response.json({ error: "not found" }, { status: 404 });
			if (req.method === "GET" && url.pathname === "/api/agent-grants")
				return Response.json(grants);
			const body = (await req.json()) as Record<string, unknown>;
			if (url.pathname === "/api/agent-grants/create") {
				const message = buildAgentGrantMessage(
					body as unknown as Parameters<typeof buildAgentGrantMessage>[0],
				);
				const valid = await verifyMessage({
					address: owner as `0x${string}`,
					message,
					signature: body.signature as `0x${string}`,
				});
				if (!valid)
					return Response.json({ error: "bad signature" }, { status: 401 });
				const grant = {
					grantId: `g-${grants.length + 1}`,
					owner,
					agent: options.answerAgent ?? body.agent,
					scopes: body.scopes,
					maxOpenNotionalUsd: body.maxOpenNotionalUsd,
					maxOpenTasks: body.maxOpenTasks,
					venues: body.venues,
					markets: body.markets,
					expiresAt: new Date(Number(body.expires) * 1000).toISOString(),
					revokedAt: null,
				};
				grants.push(grant);
				return Response.json({ grant });
			}
			if (url.pathname === "/api/agent-grants/revoke") {
				if (typeof body.signature !== "string")
					return Response.json({ error: "bad signature" }, { status: 401 });
				revoked.push(String(body.agent));
				return Response.json({ ok: true });
			}
			return Response.json({ error: "not found" }, { status: 404 });
		},
	});
	servers.push({ stop: () => server.stop(true) });
	return { base: `http://127.0.0.1:${server.port}`, grants, revoked };
}

const createArgs = [
	"grant",
	"create",
	"--scopes",
	"open",
	"--max-notional",
	"100",
	"--max-tasks",
	"1",
	"--venues",
	"hl,aster",
];

test("concurrent grant creates name the one agent key on disk, kept 0600 in a 0700 directory", async () => {
	const h = await home();
	const rt = {
		home: h.dir,
		now: Date.now,
		// The probe answers at once, so every run reaches the agent key together.
		fetch: async () => Response.json([]),
		out: () => {},
		err: () => {},
		stdoutIsTTY: false,
	};
	const values = {
		scopes: "open",
		"max-notional": "100",
		"max-tasks": "1",
		venues: "hl,aster",
	};
	await Promise.all(
		Array.from({ length: 4 }, () => grantCommand(["create"], values, rt)),
	);
	const file = join(h.dir, "grants", `${h.owner.toLowerCase()}.agent.json`);
	const onDisk = JSON.parse(await readFile(file, "utf8")).address;
	const agents = (await new ProposalStore(h.dir).list()).map(
		(p) => p.submit.body.agent,
	);
	expect(agents).toEqual([onDisk, onDisk, onDisk, onDisk]);
	expect((await lstat(file)).mode & 0o777).toBe(0o600);
	expect((await lstat(join(h.dir, "grants"))).mode & 0o777).toBe(0o700);
	expect(await readdir(join(h.dir, "grants"))).toEqual([
		`${h.owner.toLowerCase()}.agent.json`,
	]);
});

test("racing agent key loads create one key and every caller gets it", async () => {
	const h = await home();
	const keys = await Promise.all(
		Array.from({ length: 8 }, () => agentKey(h.dir, h.owner)),
	);
	const file = join(h.dir, "grants", `${h.owner.toLowerCase()}.agent.json`);
	const onDisk = JSON.parse(await readFile(file, "utf8"));
	for (const key of keys) {
		expect(key.address).toBe(onDisk.address);
		expect(key.privateKey).toBe(onDisk.privateKey);
	}
	expect(await readdir(join(h.dir, "grants"))).toEqual([
		`${h.owner.toLowerCase()}.agent.json`,
	]);
});

test("grant create refuses a symlinked or loosened agent key file and grants directory", async () => {
	const h = await home();
	const api = fakeGrantServer(h.owner, { supported: true });
	await setConfig("api_base", api.base, h.dir);
	const grants = join(h.dir, "grants");
	const file = join(grants, `${h.owner.toLowerCase()}.agent.json`);
	await mkdir(grants, { mode: 0o700 });
	await writeFile(join(h.dir, "planted.json"), "{}", { mode: 0o600 });
	await symlink(join(h.dir, "planted.json"), file);
	expect(await h.invoke(createArgs)).toBe(1);
	expect(h.err.join("\n")).toContain("symlink is not allowed");
	await rm(file);
	expect(await h.invoke(createArgs)).toBe(0);
	await chmod(file, 0o644);
	expect(await h.invoke(createArgs)).toBe(1);
	expect(h.err.join("\n")).toContain("expected mode 0600");
	await chmod(file, 0o600);
	await chmod(grants, 0o755);
	expect(await h.invoke(createArgs)).toBe(1);
	expect(h.err.join("\n")).toContain("expected mode 0700");
	expect(await readFile(join(h.dir, "planted.json"), "utf8")).toBe("{}");
});

async function home() {
	const dir = await mkdtemp(join(tmpdir(), "mstack-grant-"));
	homes.push(dir);
	const password = "grant passphrase";
	const creation = [fakeOwnerKey, password, password];
	const owner = await importKeystore(dir, async () => creation.shift() ?? "");
	await setConfig("owner", owner, dir);
	await setConfig("signer", "keystore", dir);
	await setConfig("policy", "manual", dir);
	const out: string[] = [];
	const err: string[] = [];
	const invoke = async (args: string[]) =>
		run(args, {
			home: dir,
			fetch: loopbackFetch,
			stdinIsTTY: false,
			stdoutIsTTY: false,
			out: (line) => out.push(line),
			err: (line) => err.push(line),
			readSecret: async () => password,
		});
	return { dir, owner, invoke, out, err };
}

test("grant create stages the exact owner-signed message, records the server's grant, and revoke marks it", async () => {
	const h = await home();
	const api = fakeGrantServer(h.owner, { supported: true });
	await setConfig("api_base", api.base, h.dir);
	expect(
		await h.invoke([
			"grant",
			"create",
			"--scopes",
			"open,close",
			"--max-notional",
			"5000",
			"--max-tasks",
			"3",
			"--venues",
			"hl,lighter",
			"--expires-hours",
			"24",
		]),
	).toBe(0);
	const store = new ProposalStore(h.dir);
	const p = await store.get("p-1");
	expect(p.kind).toBe("sign-text");
	expect(p.submit.route).toBe("/api/agent-grants/create");
	expect(p.submit.onAnswer).toBe("store-agent-grant");
	expect(p.signing.type).toBe("text");
	const body = p.submit.body as unknown as Parameters<
		typeof buildAgentGrantMessage
	>[0];
	expect(body.owner).toBe(h.owner);
	expect(body.scopes).toEqual(["open", "close"]);
	expect(body.expires - body.timestamp).toBe(24 * 3600);
	if (p.signing.type === "text")
		expect(p.signing.message).toBe(buildAgentGrantMessage(body));
	expect(p.purpose).toContain("Authorize agent 0x");
	expect(p.purpose).toContain("cap $5000 across 3 task(s)");
	// The agent key lives in a private file and is never printed.
	const agentFile = JSON.parse(
		await readFile(
			join(h.dir, "grants", `${h.owner.toLowerCase()}.agent.json`),
			"utf8",
		),
	);
	expect(agentFile.address).toBe(body.agent);
	expect(h.out.join("\n")).not.toContain(agentFile.privateKey);
	// The owner signs with the keystore; the server verifies and answers; the grant is recorded.
	expect(await h.invoke(["sign", "p-1", "--with", "keystore"])).toBe(0);
	expect(api.grants).toHaveLength(1);
	expect((await store.get("p-1")).status).toBe("submitted");
	const record = JSON.parse(
		await readFile(join(h.dir, "grants", "g-1.json"), "utf8"),
	);
	expect(record).toMatchObject({
		grantId: "g-1",
		owner: h.owner,
		agent: body.agent,
		scopes: ["open", "close"],
		maxOpenNotionalUsd: 5000,
		maxOpenTasks: 3,
		venues: ["hl", "lighter"],
		markets: "*",
		revokedAt: null,
	});
	h.out.length = 0;
	expect(await h.invoke(["grant", "show"])).toBe(0);
	expect(h.out.join("\n")).toContain("g-1");
	expect(h.out.join("\n")).toContain(body.agent);
	// A second create reuses the same agent key.
	expect(
		await h.invoke([
			"grant",
			"create",
			"--scopes",
			"protect",
			"--max-notional",
			"100",
			"--max-tasks",
			"1",
			"--venues",
			"aster",
		]),
	).toBe(0);
	expect((await store.get("p-2")).submit.body.agent).toBe(body.agent);
	// Revoke stages the exact message; signing marks the local record.
	expect(await h.invoke(["grant", "revoke", body.agent])).toBe(0);
	const r = await store.get("p-3");
	expect(r.submit.route).toBe("/api/agent-grants/revoke");
	if (r.signing.type === "text")
		expect(r.signing.message).toBe(
			`Revoke Mobius agent: agent=${body.agent.toLowerCase()} timestamp=${r.submit.body.timestamp}`,
		);
	expect(await h.invoke(["sign", "p-3", "--with", "keystore"])).toBe(0);
	expect(api.revoked).toEqual([body.agent]);
	const after = JSON.parse(
		await readFile(join(h.dir, "grants", "g-1.json"), "utf8"),
	);
	expect(typeof after.revokedAt).toBe("string");
});

test("without server support grant create refuses cleanly and stages nothing", async () => {
	const h = await home();
	const api = fakeGrantServer(h.owner, { supported: false });
	await setConfig("api_base", api.base, h.dir);
	expect(
		await h.invoke([
			"grant",
			"create",
			"--scopes",
			"open",
			"--max-notional",
			"100",
			"--max-tasks",
			"1",
			"--venues",
			"hl",
		]),
	).toBe(1);
	expect(h.err.join("\n")).toContain("does not offer agent grants yet");
	expect(await new ProposalStore(h.dir).list()).toEqual([]);
	expect(
		await h.invoke([
			"grant",
			"create",
			"--scopes",
			"withdraw",
			"--max-notional",
			"100",
			"--max-tasks",
			"1",
			"--venues",
			"hl",
		]),
	).toBe(1);
	expect(h.err.join("\n")).toContain("Unknown scope withdraw");
	h.out.length = 0;
	expect(await h.invoke(["grant", "show"])).toBe(0);
	expect(h.out.join("\n")).toContain("No grants.");
});

test("grant create keeps market bases as typed and refuses venue market strings", async () => {
	const h = await home();
	const api = fakeGrantServer(h.owner, { supported: true });
	await setConfig("api_base", api.base, h.dir);
	expect(
		await h.invoke([
			"grant",
			"create",
			"--scopes",
			"open",
			"--max-notional",
			"100",
			"--max-tasks",
			"1",
			"--venues",
			"hl",
			"--markets",
			"xyz:NVDA,BTC",
		]),
	).toBe(1);
	expect(h.err.join("\n")).toContain("base assets such as BTC or NVDA");
	expect(
		await h.invoke([
			"grant",
			"create",
			"--scopes",
			"open",
			"--max-notional",
			"100",
			"--max-tasks",
			"1",
			"--venues",
			"hl",
			"--markets",
			"NVDA,btc",
		]),
	).toBe(0);
	const p = await new ProposalStore(h.dir).get("p-1");
	expect(p.signing.type === "text" ? p.signing.message : "").toContain(
		" markets=NVDA,btc ",
	);
	expect(p.submit.body.markets).toEqual(["NVDA", "btc"]);
});

test("grant revoke probes the server first, and an answer naming another agent is not recorded", async () => {
	const h = await home();
	const missing = fakeGrantServer(h.owner, { supported: false });
	await setConfig("api_base", missing.base, h.dir);
	expect(await h.invoke(["grant", "revoke", `0x${"11".repeat(20)}`])).toBe(1);
	expect(h.err.join("\n")).toContain("does not offer agent grants yet");
	expect(await new ProposalStore(h.dir).list()).toEqual([]);
	const tampering = fakeGrantServer(h.owner, {
		supported: true,
		answerAgent: `0x${"22".repeat(20)}`,
	});
	await setConfig("api_base", tampering.base, h.dir);
	expect(
		await h.invoke([
			"grant",
			"create",
			"--scopes",
			"open",
			"--max-notional",
			"100",
			"--max-tasks",
			"1",
			"--venues",
			"hl",
		]),
	).toBe(0);
	expect(await h.invoke(["sign", "p-1", "--with", "keystore"])).toBe(1);
	expect(h.err.join("\n")).toContain(
		"agent address you did not sign; nothing was recorded",
	);
	h.out.length = 0;
	expect(await h.invoke(["grant", "show"])).toBe(0);
	expect(h.out.join("\n")).toContain("No grants.");
});
