import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export function releaseNotes(changelog: string, version: string): string {
	const sections = changelog.split(/^## /m);
	const section = sections.find((part) => part.startsWith(`[${version}] - `));
	if (!section) throw new Error(`CHANGELOG has no section for ${version}`);
	const body = section.slice(section.indexOf("\n") + 1).trim();
	if (!body) throw new Error(`CHANGELOG section ${version} is empty`);
	return `${body}\n`;
}

export function moveUnreleased(
	changelog: string,
	version: string,
	date: string,
): string {
	if (changelog.includes(`## [${version}] - `))
		throw new Error(`CHANGELOG already contains ${version}`);
	if (!/^## \[Unreleased\]\s*$/m.test(changelog))
		throw new Error("CHANGELOG needs an [Unreleased] section");
	const updated = changelog.replace(
		/^## \[Unreleased\][ \t]*$/m,
		`## [Unreleased]\n\n## [${version}] - ${date}`,
	);
	releaseNotes(updated, version);
	return updated;
}

async function command(root: string, args: string[], capture = false) {
	const child = Bun.spawn(args, {
		cwd: root,
		stdout: capture ? "pipe" : "inherit",
		stderr: "inherit",
	});
	const out = capture ? await new Response(child.stdout).text() : "";
	if ((await child.exited) !== 0)
		throw new Error(`Release stopped: ${args.join(" ")}`);
	return out.trim();
}

async function gates(root: string) {
	for (const args of [
		["bun", "install", "--frozen-lockfile"],
		["bun", "run", "gen:skills"],
		["git", "diff", "--exit-code", "--", "skills", "skills-codex"],
		["bun", "run", "check"],
		["bun", "run", "lint"],
		["bun", "run", "test", "--timeout", "30000"],
		["bun", "run", "deadcode"],
		["bun", "run", "build"],
		["claude", "plugin", "validate", "--strict", "."],
	])
		await command(root, args);
}

export async function release(
	version: string,
	options: { root?: string; prepare?: boolean } = {},
) {
	const root = options.root ?? resolve(import.meta.dir, "..");
	if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
		throw new Error("Use a stable version such as 0.4.0");
	if (
		await command(
			root,
			["git", "status", "--porcelain", "--untracked-files=all"],
			true,
		)
	)
		throw new Error("Release requires a clean tree, including untracked files");
	await command(root, ["git", "symbolic-ref", "--quiet", "HEAD"], true);
	if (await command(root, ["git", "tag", "--list", `v${version}`], true))
		throw new Error(`Tag v${version} already exists`);
	const original = new Map<string, string>();
	const changed = new Map<string, string>();
	const read = async (file: string) => {
		const body = await readFile(resolve(root, file), "utf8");
		original.set(file, body);
		return body;
	};
	const pkg = JSON.parse(await read("package.json"));
	const current = pkg.version as string;
	const compare = new Intl.Collator("en", { numeric: true });
	if (compare.compare(version, current) < 0)
		throw new Error(`Refusing version downgrade ${current} -> ${version}`);
	const manifests = new Set(["package.json", ".claude-plugin/plugin.json"]);
	for (const pattern of pkg.workspaces as string[]) {
		for await (const file of new Bun.Glob(`${pattern}/package.json`).scan(root))
			manifests.add(file);
	}
	for (const file of manifests) {
		const body = await read(file);
		const manifest = JSON.parse(body);
		if (manifest.version !== current)
			throw new Error(`Version mismatch in ${file}: expected ${current}`);
		changed.set(
			file,
			body.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`),
		);
	}
	// Preserve all formatting and dependency resolutions; change metadata only.
	const marketplace = await read(".claude-plugin/marketplace.json");
	changed.set(
		".claude-plugin/marketplace.json",
		marketplace.replace(/("version"\s*:\s*")[^"]+"/g, `$1${version}"`),
	);
	const lock = await read("bun.lock");
	const packageStart = lock.indexOf('\n  "packages": {');
	if (packageStart < 0) throw new Error("Unrecognized bun.lock format");
	changed.set(
		"bun.lock",
		lock
			.slice(0, packageStart)
			.replace(/("version"\s*:\s*")[^"]+"/g, `$1${version}"`) +
			lock.slice(packageStart),
	);
	const changelog = await read("CHANGELOG.md");
	if (version === current) releaseNotes(changelog, version);
	else
		changed.set(
			"CHANGELOG.md",
			moveUnreleased(changelog, version, new Date().toISOString().slice(0, 10)),
		);
	await gates(root);
	if (
		await command(
			root,
			["git", "status", "--porcelain", "--untracked-files=all"],
			true,
		)
	)
		throw new Error(
			"A release gate changed the tree; review and commit it first",
		);
	// Validate the complete edit set before touching any file. Restore it on failure.
	try {
		for (const [file, body] of changed)
			await writeFile(resolve(root, file), body);
		if (version !== current) await gates(root);
	} catch (error) {
		for (const [file, body] of original)
			await writeFile(resolve(root, file), body);
		throw error;
	}
	if (options.prepare) {
		console.log(
			`Prepared ${version}. No commit, tag or push. Review and commit these files.`,
		);
		return;
	}
	if (version !== current) {
		await command(root, ["git", "add", "--", ...changed.keys()]);
		await command(root, ["git", "commit", "-m", `chore(release): ${version}`]);
	}
	await command(root, [
		"git",
		"tag",
		"-a",
		`v${version}`,
		"-m",
		`mstack ${version}`,
	]);
	console.log(`Created local tag v${version}. Nothing pushed.`);
}

if (import.meta.main) {
	try {
		const args = process.argv.slice(2);
		if (args.length === 2 && args[0] === "--notes") {
			process.stdout.write(
				releaseNotes(await readFile("CHANGELOG.md", "utf8"), args[1]),
			);
		} else {
			if (
				args.length < 1 ||
				args.length > 2 ||
				(args[1] && args[1] !== "--prepare")
			)
				throw new Error(
					"Usage: bun scripts/release.ts <version> [--prepare] | --notes <version>",
				);
			await release(args[0], { prepare: args[1] === "--prepare" });
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
