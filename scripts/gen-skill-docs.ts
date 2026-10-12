import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const repo = resolve(import.meta.dir, "..");
const greetingRule =
	"If the preamble output contains a block between `<<<MOB` and `MOB>>>`, reproduce that block verbatim in a fenced code block at the top of your reply; never strip, trim or summarize it.";

/** Pure rendering lets tests compare both hosts without rewriting the checkout. */
export async function renderSkills(root = repo): Promise<Map<string, string>> {
	const files = (await readdir(resolve(root, "skills-src")))
		.filter((f) => f.endsWith(".md.tmpl"))
		.sort();
	if (!files.length) throw new Error("No skill templates found");
	const { version } = JSON.parse(
		await readFile(resolve(root, "package.json"), "utf8"),
	);
	const outputs = new Map<string, string>();
	const claudePreamble = await readFile(
		resolve(root, "hosts/claude/preamble.sh"),
		"utf8",
	);
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
			FRONTMATTER: `license: MIT\nmetadata:\n  version: "${version}"\n${values.frontmatter}`,
			ASK_SIZE: values.askSize as string,
			ASK_OWNER: values.askOwner as string,
			ASK_OPEN: values.askOpen as string,
			ASK_SIGN: values.askSign as string,
			PREAMBLE: "",
		};
		for (const file of files) {
			const name = file.slice(0, -".md.tmpl".length);
			const source = await readFile(resolve(root, "skills-src", file), "utf8");
			const command =
				host === "claude"
					? // biome-ignore lint/suspicious/noTemplateCurlyInString: Host and shell substitutions are literal skill content.
						'bash "${CLAUDE_SKILL_DIR}/scripts/preamble.sh"'
					: "bash ~/.agents/skills/mstack/bin/mob-preamble";
			replacements.PREAMBLE = `\`\`\`bash\n${command}${name === "mob" ? " --router" : ""}\n\`\`\`\n\n${greetingRule}`;
			let body = source.replace(/\{\{([A-Z_]+)\}\}/g, (_, key: string) => {
				if (!Object.hasOwn(replacements, key))
					throw new Error(`Unknown template field ${key}`);
				return replacements[key];
			});
			if (/\{\{|\}\}/.test(body))
				throw new Error(`Unresolved template in ${file}`);
			if (host === "codex" && /AskUserQuestion|allowed-tools:/.test(body))
				throw new Error(`Claude-only tool in ${file}`);
			if (host === "codex") body = body.replace(/`\/(mob[\w-]*)`/g, "`$$$1`");
			const directory = `${host === "claude" ? "skills" : "skills-codex"}/${name}`;
			outputs.set(`${directory}/SKILL.md`, `${body.trimEnd()}\n`);
			if (host === "claude")
				outputs.set(`${directory}/scripts/preamble.sh`, claudePreamble);
			const references = resolve(root, "skills-src", name, "references");
			for (const reference of [
				...new Bun.Glob("*.md").scanSync(references),
			].sort()) {
				outputs.set(
					`${directory}/references/${reference}`,
					await readFile(resolve(references, reference), "utf8"),
				);
			}
			if (host === "codex") {
				const description = /^description: (.+)$/m.exec(source)?.[1];
				if (!description) throw new Error(`Missing description in ${file}`);
				outputs.set(
					`${directory}/agents/openai.yaml`,
					`interface:\n  display_name: "${name}"\n  short_description: ${JSON.stringify(description.split(". ")[0].slice(0, 64))}\n`,
				);
			}
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
		if (file.endsWith(".sh")) await chmod(target, 0o755);
	}
	console.log(
		`Generated ${[...outputs.keys()].filter((file) => file.endsWith("SKILL.md")).length / 2} skills for Claude and Codex (${outputs.size} files).`,
	);
}
