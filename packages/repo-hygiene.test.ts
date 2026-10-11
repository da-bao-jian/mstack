import { expect, test } from "bun:test";
import { lstat, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { renderSkills } from "../scripts/gen-skill-docs.ts";

const root = resolve(import.meta.dir, "..");
const generated = await renderSkills();
const version = (await Bun.file(join(root, "package.json")).json()).version;

test("one small AGENTS.md is the shared repository instruction file", async () => {
	await expect(lstat(join(root, "CLAUDE.md"))).rejects.toMatchObject({
		code: "ENOENT",
	});
	const instructions = await readFile(join(root, "AGENTS.md"), "utf8");
	expect(instructions.trimEnd().split("\n").length).toBeLessThanOrEqual(200);
	expect(Buffer.byteLength(instructions)).toBeLessThan(32 * 1024);
});

for (const [file, content] of generated) {
	if (!file.endsWith("SKILL.md")) continue;
	test(`${file} follows the shared skill specification`, async () => {
		const parts = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(content);
		expect(parts).not.toBeNull();
		if (!parts) throw new Error(`Missing frontmatter: ${file}`);
		const metadata = Bun.YAML.parse(parts[1]) as Record<string, unknown>;
		const allowed = [
			"name",
			"description",
			"license",
			"compatibility",
			"metadata",
			"allowed-tools",
		];
		for (const key of Object.keys(metadata)) expect(allowed).toContain(key);
		expect(metadata.name).toBe(basename(dirname(file)));
		expect(metadata.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
		expect((metadata.name as string).length).toBeLessThanOrEqual(64);
		expect(typeof metadata.description).toBe("string");
		expect((metadata.description as string).length).toBeGreaterThan(0);
		expect((metadata.description as string).length).toBeLessThanOrEqual(1024);
		expect(metadata.license).toBe("MIT");
		expect(metadata.metadata).toEqual({ version });
		if (file.startsWith("skills-codex/"))
			expect(metadata["allowed-tools"]).toBeUndefined();
		else expect(typeof metadata["allowed-tools"]).toBe("string");
		expect(parts[2].trimEnd().split("\n").length).toBeLessThanOrEqual(500);
		expect(content.trimEnd().split("\n").length).toBeLessThanOrEqual(120);
		const preamble = /```bash\n([\s\S]*?)\n```/.exec(parts[2]);
		expect(preamble?.[1].split("\n")).toHaveLength(1);
		expect(preamble?.[1]).toContain(
			file.startsWith("skills-codex/")
				? "~/.agents/skills/mstack/bin/mob-preamble"
				: `\${CLAUDE_SKILL_DIR}/scripts/preamble.sh`,
		);
		for (const [, reference] of parts[2].matchAll(
			/\]\((references\/[^)]+)\)/g,
		)) {
			expect(reference).toMatch(/^references\/[^/]+\.md$/);
			const expected = generated.get(join(dirname(file), reference));
			if (expected === undefined)
				throw new Error(`Untracked reference: ${reference}`);
			expect(await readFile(join(root, dirname(file), reference), "utf8")).toBe(
				expected,
			);
		}
		if (file.startsWith("skills-codex/")) {
			const ui = Bun.YAML.parse(
				await readFile(join(root, dirname(file), "agents/openai.yaml"), "utf8"),
			) as { interface: { display_name: string; short_description: string } };
			expect(ui.interface.display_name).toBe(metadata.name as string);
			expect(ui.interface.short_description.length).toBeGreaterThanOrEqual(25);
			expect(ui.interface.short_description.length).toBeLessThanOrEqual(64);
		}
	});
}

test("plugin and marketplace agree on the plugin name", async () => {
	const plugin = await Bun.file(
		join(root, ".claude-plugin/plugin.json"),
	).json();
	const marketplace = await Bun.file(
		join(root, ".claude-plugin/marketplace.json"),
	).json();
	expect(marketplace.plugins[0].name).toBe(plugin.name);
	expect(plugin.displayName).toBe("mstack");
	expect(plugin).not.toHaveProperty("userConfig");
});
