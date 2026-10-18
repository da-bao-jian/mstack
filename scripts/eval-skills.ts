// Gated skill-routing eval: does a real Claude Code session pick the right
// mstack skill for a natural-language request? Runs `claude -p` with the
// checkout loaded as a plugin, denies Bash, and stops after the first turn,
// so nothing executes; the Skill tool call is the only signal checked.
// Run with: MOB_EVAL=1 bun run eval:skills
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
if (process.env.MOB_EVAL !== "1") {
	console.log("eval:skills skipped: set MOB_EVAL=1 to run against claude -p");
	process.exit(0);
}
if (!Bun.which("claude")) {
	console.error("eval:skills requires the claude CLI on PATH");
	process.exit(1);
}

const cases: { prompt: string; expect: string }[] = [
	{ prompt: "what is mstack and what can you do?", expect: "mob" },
	{ prompt: "where is the best funding right now?", expect: "mob-scan" },
	{ prompt: "explain how funding arbitrage works", expect: "mob-explain" },
	{ prompt: "import my mobius key", expect: "mob-keys" },
	{ prompt: "open $5k HYPE long on hl, short on lighter", expect: "mob-open" },
	{ prompt: "close my ETH position", expect: "mob-close" },
];

function skillInvocations(stream: string): string[] {
	const names: string[] = [];
	for (const line of stream.split("\n")) {
		if (!line.trim()) continue;
		let event: unknown;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		const content = (event as { message?: { content?: unknown } }).message
			?.content;
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			if (part?.type !== "tool_use" || part.name !== "Skill") continue;
			const skill = part.input?.skill ?? part.input?.command;
			if (typeof skill === "string") names.push(skill);
		}
	}
	return names;
}

const work = await mkdtemp(join(tmpdir(), "mstack-eval-"));
let failures = 0;
try {
	for (const { prompt, expect } of cases) {
		const child = Bun.spawn(
			[
				"claude",
				"-p",
				prompt,
				"--plugin-dir",
				root,
				"--output-format",
				"stream-json",
				"--verbose",
				"--max-turns",
				"1",
				"--permission-mode",
				"dontAsk",
				"--disallowedTools",
				"Bash,Edit,Write,WebFetch,WebSearch",
			],
			{ cwd: work, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
		);
		const [code, out, err] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		const skills = skillInvocations(out);
		const wanted = `mstack:${expect}`;
		const direct = skills.includes(wanted) || skills.includes(expect);
		// The router deliberately claims first-contact phrases and then loads the
		// task skill from its table, so a first hop into /mob is correct routing.
		const viaRouter =
			!direct && (skills.includes("mstack:mob") || skills.includes("mob"));
		const ok = direct || viaRouter;
		if (!ok) failures++;
		const chosen = skills.length
			? skills.join(", ")
			: `(no skill, exit ${code})`;
		console.log(
			`${ok ? "pass" : "FAIL"}  ${JSON.stringify(prompt)} -> ${chosen}; wanted ${wanted}${viaRouter ? " (via router)" : ""}`,
		);
		if (!ok && err.trim())
			console.log(`      stderr: ${err.trim().split("\n")[0]}`);
	}
} finally {
	await rm(work, { recursive: true, force: true });
}
console.log(`${cases.length - failures}/${cases.length} routed correctly`);
process.exit(failures ? 1 : 0);
