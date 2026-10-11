import { afterAll, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const installed = await mkdtemp(join(tmpdir(), "mstack-binary-guard-"));
afterAll(() => rm(installed, { recursive: true, force: true }));
await mkdir(join(installed, "bin"));
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
		env: { PATH: "/nonexistent" },
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
		expect(result.err).toContain("mob sign blocked:");
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
					timeout: 10,
				},
			],
		},
	]);
});

test("thin shell wrapper works in a binary-only install without Bun", async () => {
	const proc = Bun.spawn(["/bin/bash", join(installed, "sign-guard.sh")], {
		env: { PATH: "/nonexistent", CLAUDE_PLUGIN_ROOT: installed },
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
