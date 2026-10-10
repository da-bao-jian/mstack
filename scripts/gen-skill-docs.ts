import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const repo = resolve(import.meta.dir, "..");

/** Pure rendering lets tests compare both hosts without rewriting the checkout. */
export async function renderSkills(root = repo): Promise<Map<string, string>> {
	const files = (await readdir(resolve(root, "skills-src")))
		.filter((f) => f.endsWith(".md.tmpl"))
		.sort();
	if (!files.length) throw new Error("No skill templates found");
	const preamble = (
		await readFile(resolve(root, "scripts/skill-preamble.sh"), "utf8")
	).trimEnd();
	const outputs = new Map<string, string>();
	for (const host of ["claude", "codex"] as const) {
		const overlay: unknown = JSON.parse(
			await readFile(resolve(root, `hosts/${host}/overlay.json`), "utf8"),
		);
		if (!overlay || typeof overlay !== "object" || Array.isArray(overlay))
			throw new Error(`Invalid ${host} overlay`);
		const values = overlay as Record<string, unknown>;
		for (const key of [
			"frontmatter",
			"askSize",
			"askOwner",
			"askOpen",
			"askSign",
		])
			if (typeof values[key] !== "string")
				throw new Error(`Missing ${host} ${key}`);
		const replacements: Record<string, string> = {
			FRONTMATTER: values.frontmatter as string,
			ASK_SIZE: values.askSize as string,
			ASK_OWNER: values.askOwner as string,
			ASK_OPEN: values.askOpen as string,
			ASK_SIGN: values.askSign as string,
			PREAMBLE: `\`\`\`bash\n${preamble}\n\`\`\``,
		};
		for (const file of files) {
			const name = file.slice(0, -".md.tmpl".length);
			const source = await readFile(resolve(root, "skills-src", file), "utf8");
			const body = source.replace(/\{\{([A-Z_]+)\}\}/g, (_, key: string) => {
				if (!Object.hasOwn(replacements, key))
					throw new Error(`Unknown template field ${key}`);
				return replacements[key];
			});
			if (/\{\{|\}\}/.test(body))
				throw new Error(`Unresolved template in ${file}`);
			if (host === "codex" && /AskUserQuestion|allowed-tools:/.test(body))
				throw new Error(`Claude-only tool in ${file}`);
			outputs.set(
				`${host === "claude" ? "skills" : "skills-codex"}/${name}/SKILL.md`,
				`${body.trimEnd()}\n`,
			);
		}
	}
	return outputs;
}

if (import.meta.main) {
	const outputs = await renderSkills();
	for (const [file, body] of outputs) {
		const target = resolve(repo, file);
		await mkdir(resolve(target, ".."), { recursive: true });
		await writeFile(target, body);
	}
	console.log(`Generated ${outputs.size / 2} skills for Claude and Codex.`);
}
