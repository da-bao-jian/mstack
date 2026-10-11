import { readFileSync } from "node:fs";

function deny(reason: string): never {
	throw new Error(reason);
}

// The hook is a guard for literal CLI invocations, not a shell sandbox. Never
// evaluate shell text or accept authorization from assistant/tool messages.
function check(raw: string): void {
	const input = JSON.parse(raw);
	const command: unknown = input?.tool_input?.command;
	if (typeof command !== "string") deny("missing Bash command in hook input");
	const invocations = [
		...command
			.replace(/\\\r?\n/g, "")
			.matchAll(
				/(?:\bmob|\$MOB|\$\{MOB\})["']?\s+["']?sign["']?(?=\s|$)([^\n;&|]*)/g,
			),
	];
	if (!invocations.length) return;
	const ids = invocations.map((match) => {
		const tokens = match[1]
			.trim()
			.split(/\s+/)
			.map((s) => s.replace(/^(?:"([^"]*)"|'([^']*)')$/, "$1$2"));
		const ids: string[] = [];
		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i];
			if (token.startsWith("#")) break;
			if (token === "--") continue;
			if (token === "--with") {
				if (!["browser", "keystore"].includes(tokens[++i]))
					deny("use a literal signer backend");
				continue;
			}
			if (/^--with=(browser|keystore)$/.test(token)) continue;
			if (!/^p-[1-9]\d*$/.test(token))
				deny("use one literal Proposal id in each sign command");
			ids.push(token);
		}
		if (ids.length !== 1)
			deny("use one literal Proposal id in each sign command");
		return ids[0];
	});
	if (typeof input.transcript_path !== "string" || !input.transcript_path)
		deny("no transcript_path; cannot verify the latest user message");
	const transcript = readFileSync(input.transcript_path, "utf8");
	let latest: unknown;
	for (const line of transcript.split("\n")) {
		if (!line.trim()) continue;
		const event = JSON.parse(line);
		if (event.type === "user") {
			if (event.message?.role !== "user")
				deny("invalid latest user message in transcript");
			latest = event.message.content;
		}
	}
	const message =
		typeof latest === "string"
			? latest
			: Array.isArray(latest)
				? latest
						.filter(
							(part) => part?.type === "text" && typeof part.text === "string",
						)
						.map((part) => part.text)
						.join("\n")
				: "";
	for (const id of ids)
		if (!new RegExp(`(?<![A-Za-z0-9_-])${id}(?![A-Za-z0-9_-])`).test(message))
			deny(`the latest user message must name the exact Proposal id ${id}`);
}

export function signGuard(raw: string, err: (text: string) => void): number {
	try {
		check(raw);
		return 0;
	} catch (error) {
		err(
			`mob sign blocked: ${error instanceof Error ? error.message : String(error)}`,
		);
		return 2;
	}
}
