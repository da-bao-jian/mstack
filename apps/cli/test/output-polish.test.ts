import { afterAll, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProposalStore } from "@mstack/proposals";
import { fixtureContext } from "../../../packages/funding/test/fixtures.ts";
import { SETUP_FIRST, setConfig } from "../src/config.ts";
import { expiry, number, usd } from "../src/format.ts";
import { withGlossary } from "../src/glossary.ts";
import { showProposal } from "../src/proposal-view.ts";
import { API_BUDGET_MS, reachabilityLabel } from "../src/reachability.ts";
import { pct } from "../src/render.ts";
import { type Runtime, run } from "../src/run.ts";
import { renderStatus } from "../src/status.ts";
import { fakeOnboarding } from "./fixtures/fake-onboarding.ts";
import task from "./fixtures/public-task.json";

const root = await mkdtemp(join(tmpdir(), "mstack-w14-"));
afterAll(() => rm(root, { recursive: true, force: true }));
let sequence = 0;
async function harness() {
	const home = join(root, String(sequence++));
	const { ctx, calls } = await fixtureContext();
	const rt: Partial<Runtime> = {
		home,
		now: ctx.now,
		fetch: ctx.fetch,
		stdoutIsTTY: false,
	};
	async function invoke(args: string[]) {
		const lines: string[] = [],
			errors: string[] = [];
		const code = await run(args, {
			...rt,
			out: (s) => lines.push(s),
			err: (s) => errors.push(s),
		});
		return { code, out: lines.join("\n"), err: errors.join("\n") };
	}
	return { home, rt, calls, invoke };
}
const owner = "0x0000000000000000000000000000000000000001";
async function stage(home: string, now: number) {
	const store = new ProposalStore(home, () => now);
	const p = await store.stage({
		kind: "sign-text",
		owner,
		purpose: "Close test position",
		signing: {
			type: "text",
			message: "Close arbitrage task: 1842 timestamp=1787555739",
		},
		submit: {
			base: "http://127.0.0.1:1234",
			route: "/api/arbitrage/close",
			body: { taskId: "1842" },
			signatureField: "signature",
		},
		preflightPlan: {
			checks: [
				{
					route: "staged",
					name: "position.owner",
					detail: "Owner matches this position",
				},
			],
		},
	});
	return store.preview(p.id, async () => ({
		ok: true,
		checkedAt: now,
		checks: [
			{
				route: "staged",
				name: "position.owner",
				detail: "Owner matches this position",
				ok: true,
			},
		],
	}));
}

test("every config-dependent command has the exact first-run sentence without reads", async () => {
	const h = await harness();
	for (const args of [
		["status"],
		["status", "--readiness"],
		["bind", "hl"],
		["open", "BTC"],
		["close", "1842"],
		["resize", "1842"],
		["protect", "1842", "8"],
		["neutralize", "1842"],
		["auto-close", "1842", "on"],
		["size-mismatch-close", "1842", "on", "--pct", "5"],
	]) {
		expect(await h.invoke(args)).toEqual({
			code: 1,
			out: "",
			err: SETUP_FIRST,
		});
	}
	expect(h.calls).toEqual([]);
});

test("sign validates existence, expiry/terminal state, policy, configuration, then availability", async () => {
	const h = await harness();
	expect((await h.invoke(["sign", "p-1"])).err).toBe("mob: No Proposal p-1");
	const p = await stage(h.home, h.rt.now?.() as number);
	expect((await h.invoke(["sign", p.id])).err).toBe(SETUP_FIRST);
	await setConfig("policy", "locked", h.home);
	expect((await h.invoke(["sign", p.id, "--with", "missing"])).err).toContain(
		"policy is locked",
	);
	h.rt.now = () => p.expiresAt;
	expect((await h.invoke(["sign", p.id])).err).toContain("expired");
	h.rt.now = () => p.createdAt;
	await setConfig("policy", "manual", h.home);
	await setConfig("owner", owner, h.home);
	await setConfig("signer", "walletconnect", h.home);
	expect((await h.invoke(["sign", p.id])).err).toContain(
		"walletconnect_project_id",
	);
	await new ProposalStore(h.home, h.rt.now).reject(p.id);
	expect((await h.invoke(["sign", p.id])).err).toContain("terminal");
});

test("unknown options are concise and command help has only its usage, defaults and two examples", async () => {
	const h = await harness();
	expect((await h.invoke(["scan", "--sizee", "5"])).err).toBe(
		"mob: Unknown option --sizee. Did you mean --size? See `mob scan --help`.",
	);
	expect((await h.invoke(["scan", "--size"])).err).toBe(
		"mob: Invalid value for --size. See `mob scan --help`.",
	);
	for (const name of [
		"hello",
		"doctor",
		"scan",
		"rates",
		"history",
		"explain",
		"status",
		"config",
		"setup",
		"bind",
		"keystore",
		"proposals",
		"proposal",
		"preview",
		"sign",
		"reject",
		"open",
		"close",
		"neutralize",
		"resize",
		"protect",
		"auto-close",
		"size-mismatch-close",
		"upgrade",
		"mcp",
		"hook",
	]) {
		const result = await h.invoke([name, "--help"]);
		expect(result.code).toBe(0);
		expect(result.out).toContain(`mob ${name}`);
		expect(result.out).toContain("Flags:");
		expect(result.out).toContain("default:");
		expect(result.out.split("Examples:\n")[1].split("\n")).toHaveLength(2);
		expect(result.out).not.toContain("Config keys:");
	}
	const overview = await h.invoke(["--help"]);
	expect((await h.invoke(["open", "--help"])).out).toContain(
		"--size <value> (default: required)",
	);
	expect((await h.invoke(["scan", "--help"])).out).toContain(
		"--min-apy <value> (default: no filter)",
	);
	expect(overview.out).toContain("mob scan");
	expect(overview.out).toContain("mob status");
});

test("unset config is explicit only in a terminal", async () => {
	const h = await harness();
	expect(await h.invoke(["config", "get", "owner"])).toEqual({
		code: 0,
		out: "",
		err: "",
	});
	h.rt.stdoutIsTTY = true;
	expect(await h.invoke(["config", "get", "owner"])).toEqual({
		code: 0,
		out: "(unset)",
		err: "",
	});
});

test("glossary covers every emitted field and explains actual ranking gates and deployments", async () => {
	const h = await harness();
	for (const args of [
		["scan", "--json-full"],
		["rates", "--json"],
		["history", "BTC", "--json"],
	]) {
		const result = await h.invoke(args);
		expect(result.code).toBe(0);
		const { glossary, ...body } = JSON.parse(result.out);
		function check(value: unknown) {
			if (Array.isArray(value)) for (const item of value) check(item);
			else if (value && typeof value === "object")
				for (const [key, item] of Object.entries(value)) {
					expect(glossary.fields[key]?.length).toBeGreaterThan(10);
					check(item);
				}
		}
		check(body);
		expect(glossary.venues.lighter).toBe("Lighter on Robinhood Chain");
		expect(glossary.venues["lighter-mainnet"]).toBe("Lighter mainnet");
		expect(glossary.qualifies).toContain("24 hours");
		expect(glossary.executable).toContain("does not verify binding");
		expect(glossary.costModel).toContain("two fills per leg");
		expect(glossary.annualization).toContain("never compounded");
	}
	h.rt.fetch = async () => Response.json([task]);
	const status = JSON.parse(
		(await h.invoke(["status", "--owner", owner, "--json"])).out,
	);
	expect(status.tasks).toEqual([task]);
	for (const key of Object.keys(task))
		expect(status.glossary.fields[key]).toBeString();
});

test("cross-deployment hiding changes only the executable view and counts", async () => {
	const h = await harness();
	const args = [
		"scan",
		"--json-full",
		"--all-pairs",
		"--top",
		"200",
		"--top-exec",
		"200",
		"--include-thin",
	];
	const hidden = JSON.parse((await h.invoke(args)).out);
	const shown = JSON.parse(
		(await h.invoke([...args, "--include-cross-deployment"])).out,
	);
	expect(
		shown.view.executable.some((r: { flags: string[] }) =>
			r.flags.includes("cross-deployment"),
		),
	).toBe(true);
	expect(
		hidden.view.executable.some((r: { flags: string[] }) =>
			r.flags.includes("cross-deployment"),
		),
	).toBe(false);
	expect(hidden.opportunities).toEqual(shown.opportunities);
	expect(hidden.view.anywhere).toEqual(shown.view.anywhere);
	expect(hidden.counts.crossDeploymentHidden).toBe(
		shown.view.executable.length - hidden.view.executable.length,
	);
	expect(shown.counts.crossDeploymentHidden).toBe(0);
	const human = await h.invoke(["scan"]);
	expect(human.out).toMatch(
		/thin hidden: \d+ \(--include-thin\) · cross-deployment hidden: \d+ \(--include-cross-deployment\)/,
	);
	expect(h.calls.every((call) => !call.url.includes("mob.exchange"))).toBe(
		true,
	);
});

test("cards show named checks, exact bytes, expiry, owner and next command; raw data requires JSON", async () => {
	const h = await harness();
	const p = await stage(h.home, h.rt.now?.() as number);
	h.rt.now = () => p.createdAt + 2000;
	const human = await h.invoke(["proposal", "show", p.id]);
	for (const text of [
		"0x0000…0001",
		owner,
		"Expiry: in 4:58",
		"✓ position.owner: Owner matches",
		"┌─ Message",
		"│ Close arbitrage",
		p.digest,
		`Next: mob sign ${p.id}`,
	])
		expect(human.out).toContain(text);
	expect(human.out).not.toContain("Stored body:");
	expect(human.out).not.toContain("Preflight: {");
	const json = JSON.parse(
		(await h.invoke(["proposal", "show", p.id, "--json"])).out,
	);
	expect(json.signing).toEqual(p.signing);
	expect(json.submit).toEqual(p.submit);
	expect(json.signature).toBeUndefined();
	const failed = {
		...p,
		preflight: {
			...p.preflight,
			checkedAt: p.createdAt,
			ok: false,
			checks: [
				{
					route: "staged",
					name: "position.owner",
					ok: false,
					error: "Owner changed",
				},
			],
		},
	};
	expect(showProposal(failed, p.createdAt)).toContain(
		"✗ position.owner: Owner changed",
	);
	expect((await h.invoke(["proposals"])).out).toContain("expires in 4:58");
	h.rt.now = () => p.expiresAt + 720_000;
	expect((await h.invoke(["proposals"])).out).toContain("expired 12 min ago");
});

test("terminal Proposals show their end time, preserve it on repeat reject, and never advertise expiry", async () => {
	const h = await harness();
	const p = await stage(h.home, h.rt.now?.() as number);
	h.rt.now = () => p.createdAt + 1000;
	expect((await h.invoke(["reject", p.id])).code).toBe(0);
	h.rt.now = () => p.createdAt + 121_000;
	for (const args of [["proposals"], ["reject", p.id]]) {
		const result = await h.invoke(args);
		expect(result.code).toBe(0);
		expect(result.out).toContain("rejected 2 min ago");
		expect(result.out).not.toContain("Expiry:");
		expect(result.out).not.toContain("expires in");
	}
	const store = new ProposalStore(h.home, h.rt.now);
	expect((await store.get(p.id)).endedAt).toBe(p.createdAt + 1000);
	for (const status of [
		"submitted",
		"confirmed",
		"signed",
		"failed",
	] as const) {
		const saved = { ...p, status, endedAt: p.createdAt + 1000 };
		await writeFile(
			join(h.home, "proposals", `${p.id}.json`),
			JSON.stringify(saved),
		);
		const result = await h.invoke(["proposals"]);
		expect(result.out).toContain(`${status} 2 min ago`);
		expect(result.out).not.toContain("expires in");
		expect(showProposal(saved, h.rt.now())).toContain(
			`Ended: ${status} 2 min ago`,
		);
	}
	await writeFile(
		join(h.home, "proposals", `${p.id}.json`),
		JSON.stringify({ ...p, status: "rejected" }),
	);
	expect((await h.invoke(["proposals"])).out).toContain(
		"rejected (time not recorded)",
	);
	expect((await h.invoke(["reject", p.id])).out).toContain(
		"rejected (time not recorded)",
	);
});

test("reject on a live lock names the command to retry without recommending itself as a workaround", async () => {
	const h = await harness();
	const p = await stage(h.home, h.rt.now?.() as number);
	const lock = join(h.home, "proposals", `${p.id}.json.lock`);
	await mkdir(lock, { mode: 0o700 });
	const ownerPath = join(lock, "owner");
	const ownerRecord = JSON.stringify({
		pid: process.pid,
		started_at: Date.now(),
	});
	await writeFile(ownerPath, ownerRecord, { mode: 0o600 });
	expect(await h.invoke(["reject", p.id])).toEqual({
		code: 1,
		out: "",
		err: `mob: another mob process holds ${p.id}; if it crashed, wait a minute and run \`mob reject ${p.id}\` again`,
	});
	expect(await readFile(ownerPath, "utf8")).toBe(ownerRecord);
	expect((await new ProposalStore(h.home, h.rt.now).get(p.id)).status).toBe(
		"awaiting-signature",
	);
});

test("status groups fields, hides nulls, preserves JSON and uses TTY-only status colors", () => {
	const data = {
		tasks: [{ ...task, error: null, close_reason: null }],
		observedAt: Date.parse(task.updated_at),
		source: "hosted" as const,
		annualizationMethod: "simple" as const,
	};
	const colors = {
		running: 32,
		pending: 33,
		ordering: 33,
		closing: 34,
		trimming: 34,
		failed: 31,
		closed: 90,
	};
	for (const [status, color] of Object.entries(colors)) {
		data.tasks[0].status = status;
		const text = renderStatus(data, data.observedAt + 720_000, {
			stdoutIsTTY: true,
			env: { TERM: "xterm-256color" },
		});
		for (const group of ["Position", "Risk", "Activity", "Timestamps"])
			expect(text).toContain(group);
		expect(text).toContain(`\x1b[${color}m[${status}]`);
		expect(text).toContain("12 min ago");
		expect(text).not.toMatch(/^error\s/m);
		expect(text).not.toContain("close_reason");
		expect(
			renderStatus(data, data.observedAt, {
				stdoutIsTTY: false,
				env: { TERM: "xterm-256color" },
			}),
		).not.toContain("\x1b");
		expect(
			renderStatus(data, data.observedAt, {
				stdoutIsTTY: true,
				env: { TERM: "xterm-256color", NO_COLOR: "" },
			}),
		).not.toContain("\x1b");
	}
	expect(renderStatus({ ...data, tasks: [] })).toBe(
		"No positions. Try `mob scan`.",
	);
	const { glossary, ...original } = withGlossary(data);
	expect(original).toEqual(data);
	expect(glossary.fields.funding_usd).toContain("Estimated");
});

test("number, percentage, bps and relative-time formatting has stable precision", () => {
	expect(usd(1_200_000)).toBe("$1.2M");
	expect(usd(-1_200_000)).toBe("$-1.2M");
	expect(pct(12.8, 1)).toBe("12.8%");
	expect(pct(12.8, 2)).toBe("12.80%");
	expect(pct(0.012345)).toBe("0.0123%");
	expect(number(12345.6)).toBe("12,345.60");
	expect(expiry(230000, 0)).toBe("expires in 3:50");
	expect(reachabilityLabel(312)).toBe("ok · 312 ms");
	expect(reachabilityLabel(6100)).toBe("slow · 6.1 s");
	expect(API_BUDGET_MS).toBe(15000);
});

test("brand styling appears only on a color-capable TTY and respects NO_COLOR", async () => {
	const h = await harness();
	for (const [tty, noColor, colored] of [
		[true, undefined, true],
		[false, undefined, false],
		[true, "", false],
	] as const) {
		h.rt.stdoutIsTTY = tty;
		h.rt.env = { TERM: "xterm-256color", NO_COLOR: noColor };
		const result = await h.invoke(["scan"]);
		expect(result.out.includes("\x1b[")).toBe(colored);
		expect((await h.invoke(["scan", "--json"])).out).not.toContain("\x1b");
	}
});

test("setup and bind replace expired Proposals, announce freshness, and put legal statement before exact data", async () => {
	const h = await harness();
	let now = Date.now();
	const server = fakeOnboarding(owner, now);
	h.rt.now = () => now;
	h.rt.fetch = server.fetch;
	h.rt.prompt = async (_question, value) => value;
	const store = new ProposalStore(h.home, () => now);
	try {
		for (const [key, value] of [
			["owner", owner],
			["signer", "browser"],
			["api_base", server.base],
			["auth_base", server.base],
		])
			await setConfig(key, value, h.home);
		expect((await h.invoke(["setup"])).code).toBe(0);
		const first = await store.get("p-1");
		const card = showProposal(first, now);
		expect(card.indexOf("I have read and agree")).toBeGreaterThan(0);
		expect(card.indexOf("I have read and agree")).toBeLessThan(
			card.indexOf("Owner:"),
		);
		expect(card.indexOf("Owner:")).toBeLessThan(card.indexOf("Exact data"));
		now += 300_000;
		const fresh = await h.invoke(["setup"]);
		expect(fresh.code).toBe(0);
		expect(fresh.out).toContain(
			"p-1 is expired; staging a fresh legal Proposal.",
		);
		expect(fresh.out).toContain("Next: mob sign p-2");
		expect((await h.invoke(["bind", "aster"])).code).toBe(0);
		now += 300_000;
		const bound = await h.invoke(["bind", "aster"]);
		expect(bound.code).toBe(0);
		expect(bound.out).toContain(
			"p-3 is expired; staging a fresh binding Proposal.",
		);
		expect(bound.out).toContain("Next: mob sign p-4");
		expect(server.writes).toHaveLength(0);
	} finally {
		server.stop();
	}
}, 15_000);

test.each(["SIGINT", "SIGTERM"] as const)(
	"%s closes the browser server and releases the Proposal lock",
	async (signal) => {
		const h = await harness();
		const p = await stage(h.home, Date.now());
		await setConfig("owner", owner, h.home);
		await setConfig("signer", "browser", h.home);
		const proc = Bun.spawn(
			[
				process.execPath,
				"--no-env-file",
				join(import.meta.dir, "../src/main.ts"),
				"sign",
				p.id,
			],
			{
				env: { ...process.env, MOB_HOME: h.home, MOB_NO_OPEN: "1" },
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		let received!: (url: string) => void;
		const urlReady = new Promise<string>((resolve) => {
			received = resolve;
		});
		let output = "";
		const drain = (async () => {
			for await (const chunk of proc.stdout) {
				output += new TextDecoder().decode(chunk);
				const url = output.match(/http:\/\/127\.0\.0\.1:[^\s]+/);
				if (url) received(url[0]);
			}
		})();
		const timer = setTimeout(() => proc.kill(), 4000);
		try {
			const url = await urlReady;
			proc.kill(signal);
			expect(await proc.exited).toBe(0);
			await drain;
			expect(output).toContain(
				`Cancelled. ${p.id} is still awaiting signature until `,
			);
			expect(await new Response(proc.stderr).text()).toBe("");
			await expect(
				stat(join(h.home, "proposals", `${p.id}.json.lock`)),
			).rejects.toHaveProperty("code", "ENOENT");
			expect((await new ProposalStore(h.home).get(p.id)).status).toBe(
				"awaiting-signature",
			);
			// The HTTP server has closed; use node HTTP to avoid the test network guard.
			const { request } = await import("node:http");
			const error = await new Promise<Error>((resolve, reject) => {
				const req = request(url, () =>
					reject(new Error("Server still listening")),
				);
				req.on("error", resolve);
				req.end();
			});
			expect((error as NodeJS.ErrnoException).code).toBe("ECONNREFUSED");
		} finally {
			clearTimeout(timer);
			if (proc.exitCode === null) proc.kill();
			await proc.exited;
		}
	},
	8000,
);

test("interrupted list entries remain rejectable without configuration", async () => {
	const h = await harness();
	await stage(h.home, h.rt.now?.() as number);
	await writeFile(join(h.home, "proposals/p-1.signature-used"), "attempted", {
		mode: 0o600,
	});
	expect((await h.invoke(["proposals"])).out).toContain("interrupted");
	expect((await h.invoke(["reject", "p-1"])).code).toBe(0);
	expect(
		JSON.parse(await readFile(join(h.home, "proposals/p-1.json"), "utf8"))
			.status,
	).toBe("rejected");
});

test("cancelling WalletConnect closes its client and leaves an unused Proposal available", async () => {
	const { privateKeyToAccount } = await import("viem/accounts");
	const { fakeWalletConnect } = await import(
		"../../../packages/signers/test/fake-walletconnect-client.ts"
	);
	const h = await harness();
	const now = Date.now();
	h.rt.now = () => now;
	const p = await stage(h.home, now);
	const wallet = fakeWalletConnect(privateKeyToAccount(`0x${"01".repeat(32)}`));
	const originalConnect = wallet.client.connect;
	wallet.client.connect = async (params) => ({
		...(await originalConnect(params)),
		approval: () => new Promise(() => {}),
	});
	await setConfig("owner", owner, h.home);
	await setConfig("signer", "walletconnect", h.home);
	await setConfig("walletconnect_project_id", "a".repeat(32), h.home);
	const cancellation = new AbortController();
	const lines: string[] = [];
	const code = await run(["sign", p.id], {
		...h.rt,
		signal: cancellation.signal,
		walletConnectClientFactory: wallet.factory,
		out: (line) => {
			lines.push(line);
			if (line.startsWith("wc:")) cancellation.abort();
		},
		err: (line) => {
			throw new Error(line);
		},
	});
	expect(code).toBe(0);
	expect(wallet.calls.closes).toBe(1);
	expect(wallet.calls.requests).toHaveLength(0);
	expect(wallet.calls.signals[0].aborted).toBe(true);
	expect(lines.join("\n")).toContain(
		"Cancelled. p-1 is still awaiting signature until ",
	);
	expect((await new ProposalStore(h.home).get(p.id)).status).toBe(
		"awaiting-signature",
	);
	await expect(
		stat(join(h.home, "proposals/p-1.json.lock")),
	).rejects.toHaveProperty("code", "ENOENT");
});

test("unset piped config writes zero bytes, including no blank line", async () => {
	const h = await harness();
	const writes: string[] = [];
	expect(
		await run(["config", "get", "owner"], {
			...h.rt,
			stdoutIsTTY: false,
			out: (text) => writes.push(text),
			err: (text) => writes.push(text),
		}),
	).toBe(0);
	expect(writes).toEqual([]);
});

test("public status text cannot inject terminal escapes through the badge or heading", () => {
	const data = {
		tasks: [{ ...task, task_id: "1842\x1b[31m", status: "running\x1b[31m" }],
		observedAt: 0,
		source: "hosted" as const,
		annualizationMethod: "simple" as const,
	};
	expect(renderStatus(data, 0, { stdoutIsTTY: false })).not.toContain("\x1b");
});
