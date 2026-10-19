export const releaseTagFiles = [
	"docs/AGENT-INSTALL.md",
	"docs/AGENT-PROMPT.md",
	"docs/MOB-ASKS.md",
	"README.md",
] as const;

// Rewrites every `<tag>` placeholder and, when the docs already carry the
// previous release tag, that tag too, so a later release moves them forward.
export function rewriteReleaseTag(
	body: string,
	version: string,
	previous?: string,
): { body: string; replacements: number } {
	const patterns = [/<tag>/g];
	if (previous && previous !== version)
		patterns.push(
			new RegExp(`v${previous.replaceAll(".", "\\.")}(?!\\d)`, "g"),
		);
	let replacements = 0;
	let rewritten = body;
	for (const pattern of patterns) {
		replacements += rewritten.match(pattern)?.length ?? 0;
		rewritten = rewritten.replace(pattern, `v${version}`);
	}
	return { body: rewritten, replacements };
}

export function shellCommandsInSection(
	markdown: string,
	heading: string,
): string[] {
	const start = markdown.indexOf(`## ${heading}\n`);
	if (start < 0) throw new Error(`Missing section: ${heading}`);
	const rest = markdown.slice(start + heading.length + 4);
	const end = rest.search(/^## /m);
	const section = end < 0 ? rest : rest.slice(0, end);
	return [...section.matchAll(/```sh\n([\s\S]*?)```/g)].flatMap((match) =>
		match[1]
			.trim()
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean),
	);
}
