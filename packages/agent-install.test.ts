import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	releaseTagFiles,
	rewriteReleaseTag,
	shellCommandsInSection,
} from "../scripts/agent-install-doc.ts";

const root = resolve(import.meta.dir, "..");
const installPath = resolve(root, "docs/AGENT-INSTALL.md");
const install = await readFile(installPath, "utf8");

function firstTextBlock(markdown: string, after = "") {
	const start = after ? markdown.indexOf(after) : 0;
	if (start < 0) throw new Error(`Missing marker: ${after}`);
	const match = markdown.slice(start).match(/```text\n([\s\S]*?)```/);
	if (!match) throw new Error(`Missing text block after: ${after}`);
	return match[1].trimEnd();
}

test("agent install doc stays short and exposes executable host commands", async () => {
	expect(install.split("\n").length - 1).toBeLessThanOrEqual(150);
	const headings = [
		"Claude Code",
		"Codex",
		"Other MCP clients",
		"Plain shell",
		"Verify",
		"Uninstall",
	];
	for (const heading of headings)
		expect(shellCommandsInSection(install, heading).length).toBeGreaterThan(0);
	for (const heading of [
		"Claude Code",
		"Codex",
		"Other MCP clients",
		"Plain shell",
		"Verify",
	]) {
		const commands = shellCommandsInSection(install, heading);
		const welcome = commands.lastIndexOf("mob");
		expect(welcome).toBeGreaterThan(commands.indexOf("mob --version"));
		expect(welcome).toBeGreaterThan(commands.indexOf("mob doctor"));
	}

	const runSource = await readFile(
		resolve(root, "apps/cli/src/run.ts"),
		"utf8",
	);
	const keySource = await readFile(
		resolve(root, "apps/cli/src/keys-command.ts"),
		"utf8",
	);
	for (const command of ["doctor", "mcp", "onboard"])
		expect(runSource).toContain(`${command}:`);
	expect(runSource).toContain('args[0] === "--version"');
	for (const command of ["import", "delete"])
		expect(keySource).toContain(`"${command}"`);
	const shellMobReferences = headings
		.flatMap((heading) => shellCommandsInSection(install, heading))
		.flatMap((command) => {
			if (command.startsWith("mob ")) return [command];
			const piped = command.indexOf("| mob ");
			return piped < 0 ? [] : [command.slice(piped + 2)];
		});
	const mobReferences = [
		...shellMobReferences,
		...install.matchAll(/`(mob [^`\n]+)`/g),
	].map((match) => (typeof match === "string" ? match : match[1]));
	expect(mobReferences.length).toBeGreaterThan(0);
	for (const command of mobReferences)
		expect(command).toMatch(
			/^mob (?:--version|doctor|mcp|onboard|keys (?:import|delete))$/,
		);

	const setup = await readFile(resolve(root, "scripts/setup.ts"), "utf8");
	expect(await Bun.file(resolve(root, "setup")).exists()).toBe(true);
	expect(setup).toContain('host: { type: "string"');
	expect(setup).toContain('uninstall: { type: "boolean" }');
	expect(await Bun.file(resolve(root, "install.sh")).exists()).toBe(true);

	const plugin = JSON.parse(
		await readFile(resolve(root, ".claude-plugin/plugin.json"), "utf8"),
	);
	const marketplace = JSON.parse(
		await readFile(resolve(root, ".claude-plugin/marketplace.json"), "utf8"),
	);
	expect(plugin.name).toBe("mstack");
	expect(marketplace.name).toBe("mstack");

	for (const command of install.match(/claude plugin [^\n`]+/g) ?? [])
		expect(command).toMatch(
			/^claude plugin (marketplace add da-bao-jian\/mstack|install mstack@mstack|uninstall mstack@mstack)$/,
		);
	for (const command of install.match(/\.\/setup [^\n`]+/g) ?? [])
		expect(command).toMatch(/^\.\/setup --host codex(?: --uninstall)?$/);
});

test("canonical paste prompt is short and identical at every copy surface", async () => {
	const prompt = await readFile(resolve(root, "docs/AGENT-PROMPT.md"), "utf8");
	const readme = await readFile(resolve(root, "README.md"), "utf8");
	const asks = await readFile(resolve(root, "docs/MOBIUS-ASKS.md"), "utf8");
	const canonical = firstTextBlock(prompt);
	expect(canonical.split("\n").length).toBeLessThanOrEqual(6);
	expect(canonical).toContain("run `mob` and reproduce its output verbatim");
	// Auto mode treats commands in the user's own message as explicit intent.
	for (const command of shellCommandsInSection(install, "Claude Code"))
		if (command.startsWith("claude plugin") || command.includes("install.sh"))
			expect(canonical).toContain(command);
	expect(canonical).toContain("I authorize exactly:");
	const codex = firstTextBlock(prompt, "## Codex");
	for (const command of shellCommandsInSection(install, "Codex"))
		if (command.includes("./setup --host codex"))
			expect(codex).toContain(command);
	expect(install).toContain("do not work around it");
	expect(firstTextBlock(readme, "## Paste this into your agent")).toBe(
		canonical,
	);
	expect(firstTextBlock(asks, "## G. Copy prompt for mstack")).toBe(canonical);
});

test("raw install URLs and release placeholder rewrites stay pinned", async () => {
	const rawUrls =
		install.match(/https:\/\/raw\.githubusercontent\.com\/[^\s`)]+/g) ?? [];
	expect(rawUrls.length).toBeGreaterThan(0);
	for (const url of rawUrls)
		expect(url).toMatch(
			/^https:\/\/raw\.githubusercontent\.com\/da-bao-jian\/mstack\/(?:<tag>|v\d+\.\d+\.\d+)\/[^\s]+$/,
		);

	let placeholders = 0;
	let replacements = 0;
	for (const file of releaseTagFiles) {
		const body = await readFile(resolve(root, file), "utf8");
		placeholders += body.match(/<tag>/g)?.length ?? 0;
		const rewritten = rewriteReleaseTag(body, "9.8.7");
		replacements += rewritten.replacements;
		expect(rewritten.body).not.toContain("<tag>");
	}
	expect(replacements).toBe(placeholders);
	// Before a release the surfaces carry the placeholder; after the release
	// script has run they all carry the released tag. Both trees must pass.
	if (placeholders === 0) {
		const pkg = JSON.parse(
			await readFile(resolve(root, "package.json"), "utf8"),
		);
		for (const url of rawUrls) expect(url).toContain(`/v${pkg.version}/`);
	}
});
