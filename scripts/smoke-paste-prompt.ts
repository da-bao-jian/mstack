import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { shellCommandsInSection } from "./agent-install-doc.ts";

const root = resolve(import.meta.dir, "..");
if (!Bun.which("claude")) {
	console.log("smoke:paste-prompt skipped: claude CLI is absent");
	process.exit(0);
}

async function run(
	command: string,
	cwd: string,
	env: Record<string, string>,
	allowFailure = false,
) {
	const child = Bun.spawn(["/bin/sh", "-c", command], {
		cwd,
		env,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, out, err] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (code !== 0 && !allowFailure)
		throw new Error(`${command} failed (${code})\n${out}${err}`);
	return { code, out, err };
}

const temporary = await mkdtemp(join(tmpdir(), "mstack-paste-prompt-"));
const servers: ReturnType<typeof Bun.serve>[] = [];
try {
	const home = join(temporary, "home");
	const claudeConfig = join(temporary, "claude-config");
	const mobHome = join(temporary, "mob-state");
	await Promise.all([
		mkdir(home, { recursive: true }),
		mkdir(claudeConfig, { recursive: true }),
		mkdir(mobHome, { recursive: true }),
	]);

	const built = await run("bun run --cwd apps/cli build", root, {
		...process.env,
		MOB_NO_OPEN: "1",
	} as Record<string, string>);
	if (built.code !== 0) throw new Error(built.err);
	const version = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
		.version as string;
	const tag = `v${version}`;
	const platform =
		process.platform === "darwin"
			? "darwin"
			: process.platform === "linux"
				? "linux"
				: "windows";
	const arch = process.arch === "arm64" ? "arm64" : "x64";
	const asset = `mob-${platform}-${arch}${platform === "windows" ? ".exe" : ""}`;
	const binary = await Bun.file(join(root, "apps/cli/dist/mob")).bytes();
	const digest = createHash("sha256").update(binary).digest("hex");
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const path = new URL(request.url).pathname;
			if (path === "/install.sh")
				return new Response(Bun.file(join(root, "install.sh")));
			if (path === "/releases/latest/download/VERSION")
				return Response.redirect(`/releases/download/${tag}/VERSION`);
			if (path === `/releases/download/${tag}/VERSION`)
				return new Response(`${version}\n`);
			if (path === `/releases/download/${tag}/SHA256SUMS`)
				return new Response(`${digest}  ${asset}\n`);
			if (path === `/releases/download/${tag}/${asset}`)
				return new Response(binary);
			return new Response("not found", { status: 404 });
		},
	});
	servers.push(server);

	const source = join(temporary, "source");
	await cp(root, source, {
		recursive: true,
		filter(path) {
			const relative = path.slice(root.length);
			return !["/.git", "/node_modules", "/apps/cli/dist"].some(
				(excluded) =>
					relative === excluded || relative.startsWith(`${excluded}/`),
			);
		},
	});
	await run(
		`git init -q && git config user.email fixture@example.invalid && git config user.name fixture && git add . && git commit -qm fixture && git tag ${tag}`,
		source,
		process.env as Record<string, string>,
	);

	const markdown = await readFile(join(root, "docs/AGENT-INSTALL.md"), "utf8");
	const claude = shellCommandsInSection(markdown, "Claude Code");
	const codex = shellCommandsInSection(markdown, "Codex");
	const uninstall = shellCommandsInSection(markdown, "Uninstall");
	const basePath = process.env.PATH ?? "/usr/bin:/bin";
	const env: Record<string, string> = {
		...process.env,
		HOME: home,
		CLAUDE_CONFIG_DIR: claudeConfig,
		MOB_HOME: mobHome,
		MOB_NO_OPEN: "1",
		MSTACK_RELEASE_BASE_URL: `${server.url.origin}/releases/download`,
		PATH: basePath,
	};
	const rewrite = (command: string) =>
		command
			.replace(
				"claude plugin marketplace add da-bao-jian/mstack",
				`claude plugin marketplace add ${root}`,
			)
			.replace(
				`https://raw.githubusercontent.com/da-bao-jian/mstack/<tag>`,
				server.url.origin,
			)
			.replace("https://github.com/da-bao-jian/mstack", `file://${source}`)
			.replaceAll("<tag>", tag);
	const executeDocumentCommands = async (commands: string[]) => {
		const results = new Map<string, Awaited<ReturnType<typeof run>>>();
		for (const command of commands) {
			const result = await run(
				rewrite(command),
				root,
				env,
				command === "mob doctor",
			);
			results.set(command, result);
			if (command === 'export PATH="$HOME/.local/bin:$PATH"')
				env.PATH = `${join(home, ".local/bin")}:${env.PATH}`;
			if (command === 'export PATH="$HOME/.agents/skills/mstack/bin:$PATH"')
				env.PATH = `${join(home, ".agents/skills/mstack/bin")}:${env.PATH}`;
		}
		return results;
	};

	const claudeResults = await executeDocumentCommands(claude);
	const installedVersion = claudeResults.get("mob --version");
	if (!installedVersion) throw new Error("Claude version command is missing");
	if (installedVersion.out.trim() !== version)
		throw new Error(
			`mob --version printed ${JSON.stringify(installedVersion.out)}`,
		);
	const doctor = claudeResults.get("mob doctor");
	if (!doctor) throw new Error("Claude doctor command is missing");
	if (!doctor.out.includes("Binary") || !doctor.out.includes(`mob ${version}`))
		throw new Error(
			`mob doctor did not verify the binary\n${doctor.out}${doctor.err}`,
		);
	const pluginUninstall = uninstall.find((command) =>
		command.startsWith("claude plugin uninstall "),
	);
	if (!pluginUninstall) throw new Error("Claude uninstall command is missing");
	await run(pluginUninstall, root, env);

	const codexResults = await executeDocumentCommands(codex);
	const codexVersion = codexResults.get("mob --version");
	if (!codexVersion) throw new Error("Codex version command is missing");
	if (codexVersion.out.trim() !== version)
		throw new Error(
			`Codex mob --version printed ${JSON.stringify(codexVersion.out)}`,
		);
	const codexDoctor = codexResults.get("mob doctor");
	if (!codexDoctor) throw new Error("Codex doctor command is missing");
	if (
		!codexDoctor.out.includes("Binary") ||
		!codexDoctor.out.includes(`mob ${version}`)
	)
		throw new Error(
			`Codex mob doctor did not verify the binary\n${codexDoctor.out}${codexDoctor.err}`,
		);

	console.log(
		`smoke:paste-prompt passed: Claude plugin, release binary, doctor, uninstall, and Codex setup (${version})`,
	);
} finally {
	for (const server of servers) await server.stop(true);
	await rm(temporary, { recursive: true, force: true });
}
