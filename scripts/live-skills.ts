import { mkdtemp, readFile, readlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

if (process.env.MOB_LIVE !== "1")
	throw new Error("Set MOB_LIVE=1 to run the skills live smoke");
const root = resolve(import.meta.dir, "..");
const home = await mkdtemp(join(tmpdir(), "mob-skills-live-"));
const env = {
	...process.env,
	HOME: home,
	MOB_HOME: join(home, ".mob"),
	CLAUDE_PLUGIN_ROOT: "",
	PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
};

async function run(args: string[], isolated = true): Promise<string> {
	const start = performance.now();
	const proc = Bun.spawn(args, {
		cwd: root,
		env: isolated ? env : process.env,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, out, err] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	if (out.trim()) console.log(out.trimEnd());
	if (err.trim()) console.log(err.trimEnd());
	console.log(
		`exit=${code} wall=${((performance.now() - start) / 1000).toFixed(2)}s`,
	);
	if (code !== 0) throw new Error(`${args[0]} failed`);
	return out;
}

try {
	console.log("$ HOME=<temporary> ./setup --host codex -q");
	await run([join(root, "setup"), "--host", "codex", "-q"]);
	console.log("Created symlinks:");
	for (const name of [
		"mob",
		"mob-scan",
		"mob-explain",
		"mob-status",
		"mobstack/bin",
	]) {
		const path = join(home, ".codex/skills", name);
		console.log(`~/.codex/skills/${name} -> ${await readlink(path)}`);
	}
	for (const name of ["mob", "mob-scan", "mob-explain", "mob-status"]) {
		console.log(`\n$ bash <${name} preamble>`);
		const body = await readFile(
			join(home, ".codex/skills", name, "SKILL.md"),
			"utf8",
		);
		const code = /```bash\n([\s\S]*?)\n```/.exec(body)?.[1];
		if (!code) throw new Error(`Missing ${name} preamble`);
		const out = await run(["bash", "-c", code]);
		if (!out.includes("API_REACHABLE: ok"))
			throw new Error("Mobius API was unreachable");
	}
	console.log("\n$ claude plugin validate .");
	await run(["claude", "plugin", "validate", "."], false);
	console.log("\n$ claude plugin validate .claude-plugin/plugin.json");
	await run(
		["claude", "plugin", "validate", ".claude-plugin/plugin.json"],
		false,
	);
} finally {
	await run([join(root, "setup"), "--host", "codex", "--uninstall", "-q"]);
	await rm(home, { recursive: true, force: true });
}
