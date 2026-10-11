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
	CLAUDE_PLUGIN_ROOT: undefined,
	CLAUDE_SKILL_DIR: undefined,
	CLAUDE_PROJECT_DIR: undefined,
	CLAUDE_PLUGIN_DATA: undefined,
	PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
};

async function run(
	args: string[],
	isolated = true,
	cwd = root,
): Promise<string> {
	const start = performance.now();
	const proc = Bun.spawn(args, {
		cwd,
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
	const names = [
		"mob",
		"mob-scan",
		"mob-explain",
		"mob-status",
		"mob-setup",
		"mob-bind",
		"mob-open",
		"mob-manage",
		"mob-close",
	];
	for (const host of ["claude", "codex"]) {
		console.log(`$ HOME=<temporary> ./setup --host ${host} -q`);
		await run([join(root, "setup"), "--host", host, "-q"]);
		const installed = join(
			home,
			host === "claude" ? ".claude" : ".agents",
			"skills",
		);
		console.log("Created symlinks:");
		for (const name of [...names, "mstack/bin"])
			console.log(
				`${join(installed, name)} -> ${await readlink(join(installed, name))}`,
			);
		for (const name of names) {
			const directory = join(installed, name);
			console.log(`\n$ bash <${host}/${name} preamble> (cwd outside checkout)`);
			const body = await readFile(join(directory, "SKILL.md"), "utf8");
			const code = /```bash\n([\s\S]*?)\n```/.exec(body)?.[1];
			if (!code) throw new Error(`Missing ${name} preamble`);
			// Claude substitutes this exact token in skill text; it is not a shell env var.
			const rendered = code.replaceAll(`\${CLAUDE_SKILL_DIR}`, directory);
			const out = await run(["bash", "-c", rendered], true, home);
			if (!/API_REACHABLE: (ok|slow) ·/.test(out))
				throw new Error("Mobius API was unreachable");
		}
	}
	console.log("\n$ claude plugin validate --strict .");
	await run(["claude", "plugin", "validate", "--strict", "."], false);
	console.log("\n$ claude plugin validate --strict .claude-plugin/plugin.json");
	await run(
		["claude", "plugin", "validate", "--strict", ".claude-plugin/plugin.json"],
		false,
	);
} finally {
	for (const host of ["claude", "codex"])
		await run([join(root, "setup"), "--host", host, "--uninstall", "-q"]);
	await rm(home, { recursive: true, force: true });
}
