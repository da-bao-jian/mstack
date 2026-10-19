import {
	lstat,
	mkdir,
	readFile,
	readlink,
	realpath,
	rename,
	rmdir,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

interface InstallRecord {
	root: string;
	links: { path: string; target: string }[];
	/** Optional for ledgers written before W4.1; never infer old ownership. */
	directories?: string[];
}

async function exists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

async function isLink(path: string, target: string): Promise<boolean> {
	return (
		(await exists(path)) &&
		(await lstat(path)).isSymbolicLink() &&
		(await readlink(path)) === target
	);
}

async function build(root: string, quiet: boolean): Promise<void> {
	for (const args of [
		["install", "--frozen-lockfile"],
		["run", "build"],
	]) {
		const proc = Bun.spawn(["bun", ...args], {
			cwd: root,
			stdout: quiet ? "pipe" : "inherit",
			stderr: quiet ? "pipe" : "inherit",
		});
		const [code, out, err] = await Promise.all([
			proc.exited,
			quiet ? new Response(proc.stdout).text() : "",
			quiet ? new Response(proc.stderr).text() : "",
		]);
		if (code !== 0)
			throw new Error(`bun ${args.join(" ")} failed (${code})\n${out}${err}`);
	}
}

/** Only links recorded as created by this checkout are removed on uninstall. */
export async function setup(
	args: string[],
	options: {
		root?: string;
		home?: string;
		build?: (root: string, quiet: boolean) => Promise<void>;
		out?: (text: string) => void;
		showHome?: (binary: string, home: string) => Promise<void>;
	} = {},
): Promise<void> {
	const root = await realpath(options.root ?? resolve(import.meta.dir, ".."));
	const home = options.home ?? process.env.HOME;
	if (!home) throw new Error("HOME is required");
	const out = options.out ?? console.log;
	const { values } = parseArgs({
		args,
		strict: true,
		allowPositionals: false,
		options: {
			host: { type: "string", default: "auto" },
			uninstall: { type: "boolean" },
			quiet: { type: "boolean", short: "q" },
			help: { type: "boolean" },
		},
	});
	if (values.help) {
		out("Usage: ./setup [--host claude|codex|auto] [--uninstall] [-q]");
		return;
	}
	if (!["claude", "codex", "auto"].includes(values.host))
		throw new Error("host must be claude, codex, or auto");
	const hosts: string[] = [];
	for (const host of ["claude", "codex"])
		if (
			values.host === host ||
			(values.host === "auto" &&
				((await exists(join(home, `.${host}`))) ||
					(host === "codex" && (await exists(join(home, ".agents/skills"))))))
		)
			hosts.push(host);
	if (!hosts.length) {
		if (values.uninstall) return;
		throw new Error("No host detected. Use --host claude or --host codex.");
	}
	const plans: {
		host: string;
		ledger: string;
		record: InstallRecord;
		wanted: InstallRecord["links"];
		directories: string[];
	}[] = [];
	for (const host of hosts) {
		const roots = host === "codex" ? [".agents", ".codex"] : [".claude"];
		const activeRoots = [];
		for (const directory of roots)
			if (
				directory !== ".codex" ||
				values.uninstall ||
				(await exists(join(home, ".codex/skills")))
			)
				activeRoots.push(directory);
		const ledger = join(home, ".mob", `mstack-install-${host}.json`);
		const directories = activeRoots.flatMap((directory) => [
			join(home, directory),
			join(home, directory, "skills"),
			join(home, directory, "skills/mstack"),
		]);
		const linksFor = (directory: string) => {
			const skills = join(home, directory, "skills");
			return [
				{ path: join(skills, "mstack", "bin"), target: join(root, "bin") },
				...[
					"mob",
					"mob-scan",
					"mob-explain",
					"mob-status",
					"mob-setup",
					"mob-bind",
					"mob-open",
					"mob-manage",
					"mob-close",
					"mob-keys",
				].map((name) => ({
					path: join(skills, name),
					target: join(
						root,
						host === "claude" ? "skills" : "skills-codex",
						name,
					),
				})),
			];
		};
		const wanted = activeRoots.flatMap(linksFor);
		const allowedLinks = roots.flatMap(linksFor);
		const allowedDirectories = roots.flatMap((directory) => [
			join(home, directory),
			join(home, directory, "skills"),
			join(home, directory, "skills/mstack"),
		]);
		const record: InstallRecord = (await exists(ledger))
			? JSON.parse(await readFile(ledger, "utf8"))
			: { root, links: [] };
		if (
			record.root !== root ||
			!Array.isArray(record.links) ||
			record.links.some(
				(link) =>
					!allowedLinks.some(
						(w) => w.path === link.path && w.target === link.target,
					),
			)
		)
			throw new Error(
				`Install record does not belong to this checkout: ${ledger}`,
			);
		if (
			record.directories !== undefined &&
			(!Array.isArray(record.directories) ||
				record.directories.some((path) => !allowedDirectories.includes(path)))
		)
			throw new Error(`Invalid directory ownership: ${ledger}`);
		// Preflight all hosts before a build or mutation. Never replace unrelated files.
		if (!values.uninstall)
			for (const link of wanted) {
				if (
					(await exists(link.path)) &&
					!(await isLink(link.path, link.target))
				)
					throw new Error(`Refusing to replace existing path: ${link.path}`);
				if (!(await exists(link.target)))
					throw new Error(`Missing generated asset: ${link.target}`);
			}
		plans.push({ host, ledger, record, wanted, directories });
	}
	if (!values.uninstall)
		await (options.build ?? build)(root, values.quiet === true);
	for (const { host, ledger, record, wanted, directories } of plans) {
		if (values.uninstall) {
			for (const link of record.links)
				if (await isLink(link.path, link.target)) await unlink(link.path);
			if (await exists(ledger)) await unlink(ledger);
			for (const path of [...(record.directories ?? [])].reverse()) {
				try {
					if ((await lstat(path)).isDirectory()) await rmdir(path);
				} catch (error) {
					if (
						!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(
							(error as NodeJS.ErrnoException).code ?? "",
						)
					)
						throw error;
				}
			}
			if (!values.quiet)
				out(
					`Removed owned ${host} symlinks. Config and unrelated files remain.`,
				);
			continue;
		}
		await mkdir(join(home, ".mob"), { recursive: true, mode: 0o700 });
		record.directories ??= [];
		for (const path of directories)
			if (!(await exists(path))) {
				await mkdir(path);
				if (!record.directories.includes(path)) record.directories.push(path);
			}
		for (const link of wanted) {
			if (await exists(link.path)) continue;
			await mkdir(resolve(link.path, ".."), { recursive: true });
			await symlink(link.target, link.path, "dir");
			if (!record.links.some((r) => r.path === link.path))
				record.links.push(link);
			// Save after each link so an interrupted install remains uninstallable.
			const temporary = `${ledger}.${process.pid}.tmp`;
			await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
				mode: 0o600,
			});
			await rename(temporary, ledger);
		}
		if (!values.quiet) {
			out(
				`Installed ${host}: mob, mob-scan, mob-explain, mob-status, mob-setup, mob-bind, mob-open, mob-manage, mob-close, mob-keys. Binary: ${join(home, host === "codex" ? ".agents" : ".claude", "skills/mstack/bin/mob")}`,
			);
			out(
				`Optional AGENTS.md integration:\nUse ${host === "claude" ? "/mob" : "$mob"} for funding and MoB questions. The installed mstack skills cover scanning, explanations, status, onboarding, keys, binding repair, opening, managing, and closing. Manual submit and wallet signing require the latest user message to name the Proposal id; keystore signing needs the human's own terminal.`,
			);
		}
	}
	if (!values.uninstall && !values.quiet) {
		await (
			options.showHome ??
			(async (binary, home) => {
				const child = Bun.spawn([binary, "hello"], {
					env: {
						...Bun.env,
						HOME: home,
						MOB_HOME: options.home
							? join(home, ".mob")
							: (Bun.env.MOB_HOME ?? join(home, ".mob")),
					},
					stdin: "ignore",
					stdout: "inherit",
					stderr: "inherit",
				});
				if ((await child.exited) !== 0) throw new Error("Home screen failed");
			})
		)(join(root, "apps/cli/dist/mob"), home);
		out("Next commands:\n  mob setup\n  mob scan --size 1000\n  mob doctor");
	}
}

if (import.meta.main) {
	try {
		await setup(process.argv.slice(2));
	} catch (error) {
		console.error(
			`setup: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exitCode = 1;
	}
}
