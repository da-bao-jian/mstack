import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { installLatestRelease } from "./release-download.ts";

type Exec = (
	args: string[],
	cwd: string,
) => Promise<{ code: number; out: string; err: string }>;

async function execute(args: string[], cwd: string) {
	const child = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
	const [code, out, err] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { code, out, err };
}

export async function installationRoot(
	start = process.env.MSTACK_ROOT ?? dirname(process.execPath),
): Promise<string | null> {
	let current = await realpath(start);
	while (true) {
		try {
			const manifest = JSON.parse(
				await readFile(join(current, ".claude-plugin/plugin.json"), "utf8"),
			);
			if (manifest.name === "mstack") {
				try {
					await lstat(join(current, ".git"));
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
					throw error;
				}
				return current;
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		const parent = resolve(current, "..");
		if (parent === current) return null;
		current = parent;
	}
}

export async function upgrade(
	root: string | null,
	exec: Exec = execute,
): Promise<string> {
	if (root === null) return installLatestRelease();
	const run = async (args: string[]) => {
		const result = await exec(args, root);
		if (result.code !== 0)
			throw new Error(
				`${args.join(" ")} failed (${result.code}): ${result.err || result.out}`,
			);
		return result;
	};
	const remotes = await run(["git", "remote"]);
	if (!remotes.out.split(/\r?\n/).includes("origin"))
		return "no remote configured";
	await run(["git", "pull", "--ff-only"]);
	await run(["bun", "install", "--frozen-lockfile"]);
	await run(["bun", "run", "build"]);
	return "Updated mstack and rebuilt the binary. Run mob --version for the installed version.";
}
