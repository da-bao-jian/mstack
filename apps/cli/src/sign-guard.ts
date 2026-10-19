import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ProposalStore } from "@mstack/proposals";
import { configHome, readConfig } from "./config.ts";

function deny(reason: string): never {
	throw new Error(reason);
}

// The hook is a guard for literal CLI invocations, not a shell sandbox. Never
// evaluate shell text or accept authorization from assistant/tool messages.
async function check(raw: string, home: string): Promise<void> {
	const input = JSON.parse(raw);
	const command: unknown = input?.tool_input?.command;
	if (typeof command !== "string") deny("missing Bash command in hook input");
	const invocations = [
		...command
			.replace(/\\\r?\n/g, "")
			.matchAll(
				/(?:\bmob|\$MOB|\$\{MOB\})["']?\s+["']?(sign|submit)["']?(?=\s|$)([^\n]*)/g,
			),
	];
	if (!invocations.length) return;
	await readFile(join(home, "config.json"), "utf8").catch(() =>
		deny("missing or unreadable config; cannot verify policy"),
	);
	const config = await readConfig(home).catch(() =>
		deny("missing or unreadable config; cannot verify policy"),
	);
	const policy = config.policy ?? "manual";
	if (policy === "locked") deny("policy is locked");
	const requests = invocations.map((match) => {
		const tokens =
			match[2]
				.trim()
				.match(
					/(?:\d*>&\d+|\d*>>?|\|\||&&|[|;&<]|"[^"]*"|'[^']*'|[^\s<>|;&]+)/g,
				) ?? [];
		const literal = (s: string) =>
			s.replace(/^(?:"([^"]*)"|'([^']*)')$/, "$1$2");
		const unexpected = (i: number): never =>
			deny(
				`unexpected token \`${tokens.slice(i, i + 2).join(" ")}\` after the Proposal id`,
			);
		const ids: string[] = [];
		for (let i = 0; i < tokens.length; i++) {
			const token = literal(tokens[i]);
			if (token.startsWith("#")) break;
			if (token === "--") continue;
			if (token === "--with") {
				if (
					!["browser", "keystore", "walletconnect", "approver"].includes(
						literal(tokens[++i] ?? ""),
					)
				)
					deny("use a literal signer backend");
				continue;
			}
			if (/^--with=(browser|keystore|walletconnect|approver)$/.test(token))
				continue;
			if (ids.length === 1) {
				if (/^[12]?>&[12]$/.test(token)) continue;
				if (/^[12]?>>?$/.test(token)) {
					const target = tokens[++i];
					if (!target || !/^(?:[\w./-]+|"[\w ./-]+"|'[\w ./-]+')$/.test(target))
						unexpected(i - 1);
					continue;
				}
				if (token === "|" && ["tee", "cat"].includes(tokens[i + 1])) {
					const sink = tokens[++i];
					for (++i; i < tokens.length; i++) {
						if (
							sink === "tee" &&
							(tokens[i] === "-a" ||
								/^(?:[\w./-]+|"[\w ./-]+"|'[\w ./-]+')$/.test(tokens[i]))
						)
							continue;
						unexpected(i);
					}
					break;
				}
				unexpected(i);
			}
			const validId =
				match[1] === "sign"
					? /^[pc]-[1-9]\d*$/.test(token)
					: /^p-[1-9]\d*$/.test(token);
			if (!validId) deny("use one literal Proposal id in each sign command");
			ids.push(token);
		}
		if (ids.length !== 1)
			deny("use one literal Proposal id in each sign command");
		return { action: match[1] as "sign" | "submit", id: ids[0] };
	});
	if (policy === "auto") {
		for (const request of requests) {
			if (request.action === "sign") deny("policy auto still blocks mob sign");
			const proposal = await new ProposalStore(home).get(request.id);
			if (proposal.kind !== "api-submit")
				deny(`${request.id} is not an api-submit Proposal`);
		}
		return;
	}
	if (typeof input.transcript_path !== "string" || !input.transcript_path)
		deny("no transcript_path; cannot verify the latest user message");
	const transcript = readFileSync(input.transcript_path, "utf8");
	// The latest human input is either a typed message or the answer the human
	// chose from a question the assistant asked. Every other tool result is
	// data and never replaces or grants consent.
	let latest:
		| { kind: "text"; text: string }
		| { kind: "answers"; answers: string[] } = { kind: "text", text: "" };
	const questions = new Set<string>();
	for (const line of transcript.split("\n")) {
		if (!line.trim()) continue;
		const event = JSON.parse(line);
		if (event.type === "assistant" && Array.isArray(event.message?.content)) {
			for (const part of event.message.content)
				if (
					part?.type === "tool_use" &&
					part.name === "AskUserQuestion" &&
					typeof part.id === "string"
				)
					questions.add(part.id);
			continue;
		}
		if (
			event.type !== "user" ||
			event.isMeta ||
			event.isSidechain ||
			event.isSideChain
		)
			continue;
		if (event.message?.role !== "user")
			deny("invalid latest user message in transcript");
		const content = event.message.content;
		if (typeof content === "string") {
			latest = { kind: "text", text: content };
			continue;
		}
		if (!Array.isArray(content))
			deny("invalid latest user message in transcript");
		const texts = content.filter(
			(part) => part?.type === "text" && typeof part.text === "string",
		);
		const results = content.filter((part) => part?.type === "tool_result");
		if (texts.length && !results.length) {
			latest = {
				kind: "text",
				text: texts.map((part) => part.text).join("\n"),
			};
			continue;
		}
		if (
			content.length === 1 &&
			results.length === 1 &&
			questions.has(results[0].tool_use_id)
		) {
			const answers = chosenAnswers(results[0].content);
			if (answers.length) latest = { kind: "answers", answers };
		}
	}
	for (const { id, action } of requests) {
		if (latest.kind === "text") {
			if (
				!new RegExp(`(?<![A-Za-z0-9_-])${id}(?![A-Za-z0-9_-])`).test(
					latest.text,
				)
			)
				deny(`the latest user message must name the exact Proposal id ${id}`);
			continue;
		}
		const verb = action === "sign" ? "Sign" : "Submit";
		if (
			!latest.answers.some((answer) =>
				new RegExp(`^\\s*${verb}\\s+${id}(?![A-Za-z0-9_-])`, "i").test(answer),
			)
		)
			deny(`the answer you chose must start with "${verb} ${id}"`);
	}
}

/** The labels the human picked, from an AskUserQuestion tool result. */
function chosenAnswers(content: unknown): string[] {
	const text =
		typeof content === "string"
			? content
			: Array.isArray(content)
				? content
						.filter(
							(part) => part?.type === "text" && typeof part.text === "string",
						)
						.map((part) => part.text)
						.join("\n")
				: "";
	return [...text.matchAll(/"((?:[^"\\]|\\.)*)"="((?:[^"\\]|\\.)*)"/g)].map(
		(match) => match[2],
	);
}

export async function signGuard(
	raw: string,
	err: (text: string) => void,
	home?: string,
): Promise<number> {
	try {
		// The CLI's own home rule: an empty MOB_HOME is unset, a relative one blocks.
		await check(raw, home ?? configHome());
		return 0;
	} catch (error) {
		err(
			`mob mutation blocked: ${error instanceof Error ? error.message : String(error)}`,
		);
		return 2;
	}
}
