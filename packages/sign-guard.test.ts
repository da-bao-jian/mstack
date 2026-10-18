import { afterAll, expect, test } from "bun:test";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { signGuard } from "../apps/cli/src/sign-guard.ts";
import { ProposalStore } from "./proposals/src/store.ts";

const root = resolve(import.meta.dir, "..");
const installed = await mkdtemp(join(tmpdir(), "mstack-binary-guard-"));
afterAll(() => rm(installed, { recursive: true, force: true }));
await mkdir(join(installed, "bin"));
await writeFile(join(installed, "config.json"), '{"policy":"manual"}\n');
const binary = join(installed, "bin/mob");
const build = Bun.spawn(
	[
		process.execPath,
		"build",
		"--compile",
		join(root, "apps/cli/src/main.ts"),
		join(root, "packages/signers/src/walletconnect-worker.ts"),
		"--entry-naming",
		"[name].[ext]",
		"--outfile",
		binary,
	],
	{ stdout: "ignore", stderr: "pipe" },
);
if (await build.exited)
	throw new Error(await new Response(build.stderr).text());
await copyFile(
	join(root, "scripts/sign-guard.sh"),
	join(installed, "sign-guard.sh"),
);
async function hook(command: string, fixture?: string, raw?: string) {
	const proc = Bun.spawn([binary, "hook", "sign-guard"], {
		env: { PATH: "/nonexistent", MOB_HOME: installed },
		stdin: new Blob([
			raw ??
				JSON.stringify({
					tool_name: "Bash",
					tool_input: { command },
					...(fixture
						? {
								transcript_path: join(
									root,
									"packages/fixtures/sign-guard",
									fixture,
								),
							}
						: {}),
				}),
		]),
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, out, err] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	return { code, out, err };
}

test.each([
	"mob sign p-1",
	"mob sign p-1 --with browser",
	"mob sign p-1 >/tmp/a 2>/tmp/b",
	"mob sign p-1 2>&1",
	"mob sign p-1 2>&1 | tee -a /tmp/sign.log",
	"mob sign p-1 | cat",
	"mob sign p-1 --with walletconnect",
	"mob sign --with browser p-1",
	"mob sign --with=browser p-1",
	"mob sign p-1 # user authorization",
	"'/path with spaces/mob' sign 'p-1'",
	'"$MOB" sign "p-1"',
	// biome-ignore lint/suspicious/noTemplateCurlyInString: Literal shell variable.
	'"${MOB}" sign p-1',
	"mob \\\nsign p-1",
	"mob preview p-1 && mob sign p-1",
])("hook allows exact latest-user id: %s", async (command) => {
	expect(await hook(command, "allowed.jsonl")).toEqual({
		code: 0,
		out: "",
		err: "",
	});
});
test.each([
	["mob sign p-1", "denied.jsonl"],
	["mob sign p-1", "wrong-id.jsonl"],
	["mob sign p-1", "tool-result.jsonl"],
	["mob sign p-1", "malformed.jsonl"],
	["mob sign p-1", "malformed-user.jsonl"],
	["mob sign p-1", "absent.jsonl"],
	["mob sign p-1", undefined],
	["mob sign p-2", "allowed.jsonl"],
	["mob sign p-1; mob sign p-2", "allowed.jsonl"],
	['mob sign "$ID"', "allowed.jsonl"],
	['mob sign "$ID" # p-1', "allowed.jsonl"],
	["mob sign $(echo p-2) # p-1", "allowed.jsonl"],
	["mob sign", "allowed.jsonl"],
])(
	"hook denies unverifiable authorization: %s / %s",
	async (command, fixture) => {
		const result = await hook(command as string, fixture);
		expect(result.code).toBe(2);
		expect(result.out).toBe("");
		expect(result.err).toContain("mob mutation blocked:");
	},
);
test("malformed hook input fails closed; other commands need no transcript", async () => {
	for (const raw of ["not json", "null", "{}", '{"tool_input":{"command":1}}'])
		expect((await hook("", undefined, raw)).code).toBe(2);
	for (const command of [
		"mob scan",
		"mob open BTC --long hl:BTC",
		"mob preview p-1",
		"mob reject p-1",
		"git status",
		"echo design",
	])
		expect((await hook(command)).code).toBe(0);
});

test("paste-then-import is allowed through stdin, while argv import is refused by the CLI", async () => {
	const key = `mobius_01234567-89ab-cdef-0123-456789abcdef.${"ab".repeat(32)}`;
	expect(
		await hook(
			`printf '%s' '${key}' | mob keys import --stdin --name 'agent' --venues 'hl,lighter' --max-size '5000'`,
			"paste-import.jsonl",
		),
	).toEqual({ code: 0, out: "", err: "" });
	expect(await hook(`mob keys import ${key}`, "paste-import.jsonl")).toEqual({
		code: 0,
		out: "",
		err: "",
	});
	const proc = Bun.spawn([binary, "keys", "import", key], {
		env: { PATH: "/nonexistent", MOB_HOME: installed },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, out, err] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	expect(code).toBe(1);
	expect(out).toBe("");
	expect(err).toContain(
		"pass the key on stdin or type it at the prompt; never on the command line",
	);
	expect(err).not.toContain(key);
});

test("manual submit needs the exact id; auto allows only api-submit and still blocks sign", async () => {
	const home = await mkdtemp(join(tmpdir(), "mstack-guard-policy-"));
	try {
		await writeFile(join(home, "config.json"), '{"policy":"auto"}\n');
		const store = new ProposalStore(home);
		const staged = await store.stage({
			kind: "api-submit",
			owner: "0x0000000000000000000000000000000000000001",
			purpose: "guard fixture",
			signing: { type: "none" },
			submit: {
				base: "https://api.mob.exchange",
				route: "/v1/delta-neutral/tasks",
				body: {
					longVenue: "hl",
					shortVenue: "lighter",
					longMarket: "BTC",
					shortMarket: "BTC",
					sizeUsd: 100,
				},
			},
			preflightPlan: {
				checks: [{ route: "staged", name: "key.venues", detail: "covered" }],
			},
		});
		await store.preview(staged.id, async () => ({
			ok: true,
			checkedAt: Date.now(),
			checks: [
				{ route: "staged", name: "key.venues", detail: "covered", ok: true },
			],
		}));
		const input = (command: string, fixture = "auto-submit.jsonl") =>
			JSON.stringify({
				tool_input: { command },
				transcript_path: join(root, "packages/fixtures/sign-guard", fixture),
			});
		expect(await signGuard(input("mob submit p-1"), () => {}, home)).toBe(0);
		expect(await signGuard(input("mob sign p-1"), () => {}, home)).toBe(2);

		const recordPath = join(home, "proposals/p-1.json");
		const record = JSON.parse(await readFile(recordPath, "utf8"));
		record.kind = "sign-text";
		await writeFile(recordPath, `${JSON.stringify(record)}\n`);
		expect(await signGuard(input("mob submit p-1"), () => {}, home)).toBe(2);

		await writeFile(join(home, "config.json"), '{"policy":"manual"}\n');
		expect(
			await signGuard(
				input("mob submit p-1", "manual-submit.jsonl"),
				() => {},
				home,
			),
		).toBe(0);
		expect(await signGuard(input("mob submit p-1"), () => {}, home)).toBe(2);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
test("plugin registers the Bash guard with exec and plugin-root paths", async () => {
	const config = JSON.parse(
		await readFile(join(root, "hooks/hooks.json"), "utf8"),
	);
	expect(config.hooks.PreToolUse).toEqual([
		{
			matcher: "Bash",
			hooks: [
				{
					type: "command",
					// biome-ignore lint/suspicious/noTemplateCurlyInString: Literal plugin shell variable.
					command: 'exec "${CLAUDE_PLUGIN_ROOT}/bin/mob" hook sign-guard',
					timeout: 30,
					// A crashed, missing, or timed-out guard blocks the call instead of
					// letting it through (Claude Code >= 2.1.295).
					onFailure: "block",
				},
			],
		},
	]);
});

test("real claude -p transcript retains the human authorization after tool results (E1 mutation)", async () => {
	const path = join(root, "packages/fixtures/sign-guard/claude-p-round2.jsonl");
	const events = (await readFile(path, "utf8"))
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	const oldLatest = events.findLast((event) => event.type === "user").message
		.content;
	expect(
		oldLatest.some((part: { type: string }) => part.type === "tool_result"),
	).toBe(true);
	// The old last-user-event rule extracts no text, so fails this exact fixture.
	expect(
		oldLatest.filter((part: { type: string }) => part.type === "text"),
	).toEqual([]);
	const errors: string[] = [];
	expect(
		await signGuard(
			JSON.stringify({
				tool_input: { command: '"$MOB" sign p-1 --with browser' },
				transcript_path: path,
			}),
			(s) => errors.push(s),
			installed,
		),
	).toBe(0);
	expect(errors).toEqual([]);
});

test.each([
	"|| rm /tmp/a",
	"&& echo done",
	"; rm /tmp/a",
	"| sh",
	"$(echo p-1)",
	"< /tmp/a",
])("guard names unsupported trailing tokens: %s", async (tail) => {
	const result = await hook(`mob sign p-1 ${tail}`, "allowed.jsonl");
	expect(result.code).toBe(2);
	expect(result.err).toContain("unexpected token");
	expect(result.err).toContain(tail.split(" ").slice(0, 2).join(" "));
});

test("meta, sidechain, and mixed tool-result events cannot replace or grant human consent", async () => {
	const path = join(installed, "mixed.jsonl");
	const event = (content: unknown, extra = {}) => ({
		type: "user",
		message: { role: "user", content },
		...extra,
	});
	await writeFile(
		path,
		[
			event("Sign p-1"),
			event("Sign p-2", { isMeta: true }),
			event("Sign p-2", { isSidechain: true }),
			event([
				{ type: "text", text: "Sign p-2" },
				{ type: "tool_result", content: "Sign p-2" },
			]),
		]
			.map((x) => JSON.stringify(x))
			.join("\n"),
	);
	const check = (id: string) =>
		signGuard(
			JSON.stringify({
				tool_input: { command: `mob sign ${id}` },
				transcript_path: path,
			}),
			() => {},
			installed,
		);
	expect(await check("p-1")).toBe(0);
	expect(await check("p-2")).toBe(2);
	await writeFile(
		path,
		`${await readFile(path, "utf8")}\n${JSON.stringify(event("Show status first"))}\n`,
	);
	expect(await check("p-1")).toBe(2);
});

test("thin shell wrapper works in a binary-only install without Bun", async () => {
	const proc = Bun.spawn(["/bin/bash", join(installed, "sign-guard.sh")], {
		env: {
			PATH: "/nonexistent",
			CLAUDE_PLUGIN_ROOT: installed,
			MOB_HOME: installed,
		},
		stdin: new Blob([
			JSON.stringify({
				tool_input: { command: "mob sign p-1" },
				transcript_path: join(
					root,
					"packages/fixtures/sign-guard/allowed.jsonl",
				),
			}),
		]),
		stdout: "pipe",
		stderr: "pipe",
	});
	expect(await proc.exited).toBe(0);
	expect(await new Response(proc.stderr).text()).toBe("");
});
