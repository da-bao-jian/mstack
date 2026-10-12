export const releaseTagFiles = [
	"docs/AGENT-INSTALL.md",
	"docs/AGENT-PROMPT.md",
	"docs/MOBIUS-ASKS.md",
	"README.md",
] as const;

export function rewriteReleaseTag(
	body: string,
	version: string,
): { body: string; replacements: number } {
	const matches = body.match(/<tag>/g);
	return {
		body: body.replaceAll("<tag>", `v${version}`),
		replacements: matches?.length ?? 0,
	};
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
