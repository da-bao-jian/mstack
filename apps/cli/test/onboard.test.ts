import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress } from "viem";
import { setConfig } from "../src/config.ts";
import { type Runtime, run } from "../src/run.ts";

const owner = "0x0000000000000000000000000000000000000001";
const casedOwner = "0xa4e8ab55b434e5486550eb51b4b314ec9fb5fbde";
const key = `mobius_01234567-89ab-cdef-0123-456789abcdef.${"ab".repeat(32)}`;
const now = 1_800_000_000_000;
const homes: string[] = [];

afterEach(async () => {
	await Promise.all(
		homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
	);
});

async function home() {
	const path = await mkdtemp(join(tmpdir(), "mstack-onboard-"));
	homes.push(path);
	await setConfig("key_store", "file", path);
	return path;
}

function fakeFetch(states: Record<string, "bound" | "repair" | "unbound">) {
	return async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(String(input));
		if (url.pathname === "/legal/acceptance")
			return Response.json({
				accepted: true,
				termsVersion: "2026-10-12",
				privacyVersion: "2026-10-12",
				acceptedAt: "2026-10-12T00:00:00Z",
			});
		if (url.pathname === "/api/binding/readiness")
			return Response.json({
				ready: Object.values(states).every((state) => state === "bound"),
				venues: Object.entries(states).map(([venue, state]) => ({
					venue,
					bound: state !== "unbound",
					ready: state === "bound",
					...(state === "repair" ? { issue: "builder approval missing" } : {}),
					...(state === "unbound" ? { issue: "not_bound" } : {}),
				})),
			});
		if (url.pathname === "/v1/delta-neutral/tasks") {
			expect(new Headers(init?.headers).get("authorization")).toBe(
				`Bearer ${key}`,
			);
			return Response.json({ tasks: [], nextCursor: null });
		}
		throw new Error(`unexpected ${url}`);
	};
}

async function invoke(
	home: string,
	args: string[],
	overrides: Partial<Runtime> = {},
) {
	const out: string[] = [];
	const err: string[] = [];
	const opened: string[] = [];
	const code = await run(args, {
		home,
		now: () => now,
		stdinIsTTY: false,
		stdoutIsTTY: false,
		env: { ...process.env, MOB_NO_OPEN: "0" },
		out: (line) => out.push(line),
		err: (line) => err.push(line),
		openUrl: async (url) => {
			opened.push(url);
		},
		fetch: fakeFetch({ hl: "bound", lighter: "unbound" }),
		...overrides,
	});
	return { code, out: out.join("\n"), err: err.join("\n"), opened };
}

test("onboard saves owner and app base, prints public states and exact handoff", async () => {
	const path = await home();
	const result = await invoke(path, [
		"onboard",
		"--owner",
		owner,
		"--app-base",
		"https://app.example.test/base",
		"--venues",
		"hl,lighter",
	]);
	expect(result.code).toBe(0);
	expect(result.opened).toEqual(["https://app.example.test/base/?nav=api"]);
	expect(result.out).toContain("Open https://app.example.test/base/?nav=api");
	expect(result.out).toContain("Legal  ✓ accepted");
	expect(result.out).toContain("hl      ✓ bound");
	expect(result.out).toContain("lighter – not bound · not_bound");
	expect(result.out).toContain("Key    – none");
	expect(result.out).toContain(
		"Then the user copies the key and pastes it into the chat; the agent stores it with `mob keys import --stdin` and the CLI never prints it again.",
	);
	expect(result.out).toContain(
		"A human at a terminal may instead run `mob keys import` and paste it hidden.",
	);
	expect(result.out.endsWith("Next: bind lighter on the page")).toBe(true);
	expect(await invoke(path, ["config", "get", "owner"])).toMatchObject({
		out: owner,
	});
	expect(await invoke(path, ["config", "get", "app_base"])).toMatchObject({
		out: "https://app.example.test/base",
	});
});

test("onboard and config set store the same checksummed owner", async () => {
	const path = await home();
	const onboarded = await invoke(path, ["onboard", "--owner", casedOwner]);
	expect(onboarded.code).toBe(0);
	expect(await invoke(path, ["config", "get", "owner"])).toMatchObject({
		out: getAddress(casedOwner),
	});
	const configured = await invoke(path, ["config", "set", "owner", casedOwner]);
	expect(configured.code).toBe(0);
	expect(await invoke(path, ["config", "get", "owner"])).toMatchObject({
		out: getAddress(casedOwner),
	});
});

test("onboard reports repair text and throttles opener per owner for one hour", async () => {
	const path = await home();
	const first = await invoke(path, ["onboard", "--owner", owner], {
		fetch: fakeFetch({ hl: "repair" }),
	});
	expect(first.opened).toHaveLength(1);
	expect(first.out).toContain(
		"hl      ✗ needs repair · builder approval missing",
	);
	const second = await invoke(path, ["onboard"], {
		fetch: fakeFetch({ hl: "repair" }),
	});
	expect(second.opened).toHaveLength(0);
	expect(second.out).toContain("Open https://app.mob.exchange/?nav=api");
	const third = await invoke(path, ["onboard"], {
		now: () => now + 3_600_001,
		fetch: fakeFetch({ hl: "repair" }),
	});
	expect(third.opened).toHaveLength(1);
});

test("MOB_NO_OPEN suppresses the onboarding opener but the URL is still printed", async () => {
	const path = await home();
	const result = await invoke(path, ["onboard", "--owner", owner], {
		env: { ...process.env, MOB_NO_OPEN: "1" },
	});
	expect(result.code).toBe(0);
	expect(result.opened).toEqual([]);
	expect(result.out).toContain("Open https://app.mob.exchange/?nav=api");
});

test("onboard shows missing legal acceptance without staging or signing", async () => {
	const path = await home();
	const result = await invoke(
		path,
		["onboard", "--owner", owner, "--venues", "hl"],
		{
			fetch: async (input, init) => {
				const url = new URL(String(input));
				if (url.pathname === "/legal/acceptance")
					return Response.json({
						accepted: false,
						termsVersion: "2026-10-12",
						privacyVersion: "2026-10-12",
						acceptedAt: null,
					});
				return fakeFetch({ hl: "bound" })(input, init);
			},
		},
	);
	expect(result.code).toBe(0);
	expect(result.out).toContain("Legal  ✗ missing");
	expect(result.out).toContain("hl      ✓ bound");
	expect(result.out.endsWith("Next: paste the key in the chat")).toBe(true);
});

test("non-TTY onboard requires owner and imported key makes the checklist Ready", async () => {
	const path = await home();
	const missing = await invoke(path, ["onboard"]);
	expect(missing.code).toBe(1);
	expect(missing.err).toContain("--owner");

	await setConfig("owner", owner, path);
	await setConfig("api_base", "http://127.0.0.1:9988", path);
	const imported = await invoke(
		path,
		[
			"keys",
			"import",
			"--stdin",
			"--venues",
			"hl,lighter",
			"--max-size",
			"5000",
		],
		{ readStdin: async () => key },
	);
	expect(imported.code).toBe(0);
	await setConfig("strategy_api_base", "http://127.0.0.1:9989", path);
	const ready = await invoke(path, ["onboard", "--venues", "hl,lighter"], {
		fetch: async (input, init) => {
			const url = new URL(String(input));
			if (url.pathname === "/v1/delta-neutral/tasks")
				expect(url.origin).toBe("http://127.0.0.1:9989");
			return fakeFetch({ hl: "bound", lighter: "bound" })(input, init);
		},
	});
	expect(ready.code).toBe(0);
	expect(ready.out).not.toContain(key);
	expect(ready.out).toContain(
		"Key    ✓ verified ok · mobius_01234567-89ab-cdef-0123-456789abcdef…",
	);
	expect(ready.out).toContain(
		"Ready · 2 venues bound · key mobius_01234567-89ab-cdef-0123-456789abcdef… · cap $5,000",
	);
	expect(ready.out).not.toMatch(/^Key\s+.*not checked$/m);
	expect(ready.out).not.toMatch(/^Legal\s+.*not checked$/m);
	expect(ready.out.endsWith("Ready")).toBe(true);
});

test("TTY onboard prompts for owner and watch redraws with an injected clock", async () => {
	const path = await home();
	await setConfig("owner", owner, path);
	await setConfig("api_base", "http://127.0.0.1:9988", path);
	await setConfig("strategy_api_base", "http://127.0.0.1:9988", path);
	expect(
		(
			await invoke(path, ["keys", "import", "--stdin", "--venues", "hl"], {
				readStdin: async () => key,
			})
		).code,
	).toBe(0);
	let time = now;
	let reads = 0;
	const frames: string[] = [];
	const result = await invoke(path, ["onboard", "--watch", "--venues", "hl"], {
		stdinIsTTY: true,
		stdoutIsTTY: true,
		now: () => time,
		sleep: async (ms) => {
			time += ms;
		},
		writeStatus: (frame) => frames.push(frame),
		fetch: async (input, init) => {
			const url = new URL(String(input));
			if (url.pathname === "/api/binding/readiness") reads++;
			return fakeFetch({ hl: reads > 1 ? "bound" : "unbound" })(input, init);
		},
	});
	expect(result.code).toBe(0);
	expect(reads).toBe(2);
	expect(frames.join("\n")).toContain("\x1b[2J\x1b[H");
	expect(result.out.endsWith("Ready")).toBe(true);
});
