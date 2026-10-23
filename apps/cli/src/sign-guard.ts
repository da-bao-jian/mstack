import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ProposalStore } from "@mstack/proposals";
import { configHome, readConfig } from "./config.ts";

function deny(reason: string): never {
	throw new Error(reason);
}

// A command word that runs mob: `mob`, a path ending in /mob or /mob-<version>
// (optionally under $HOME or the plugin root), or the preamble's $MOB/$MOB_BIN.
const VERSION = String.raw`(?:-\d+(?:\.\d+)*(?:[-+][\w.]+)?)?`;
const ROOT = String.raw`(?:(?:\$(?:HOME|CLAUDE_PLUGIN_ROOT)|\$\{(?:HOME|CLAUDE_PLUGIN_ROOT)\})/)?`;
const VARIABLE = String.raw`\$MOB(?:_BIN)?|\$\{MOB(?:_BIN)?\}`;
const BARE_PATH = new RegExp(
	String.raw`^(?:${ROOT}(?:[^\s'"\\$\`;&|<>(){}*?[\]#]*/)?mob${VERSION}|${VARIABLE})$`,
);
const QUOTED_PATH = new RegExp(
	String.raw`^(?:${ROOT}(?:[^"\\$\`\n]*/)?mob${VERSION}|${VARIABLE})$`,
);
const LITERAL_PATH = new RegExp(String.raw`^(?:[^'\n]*/)?mob${VERSION}$`);
const WORD = String.raw`(?:'[^'\n]*'|"[^"\n]*"|[^\s'";&|<>()]+)`;
const START = String.raw`(?:^|\n|;|&&|\|\|)[ \t]*`;
const INVOCATION = new RegExp(
	String.raw`${START}(${WORD})[ \t]+(["']?)(sign|submit)\2(?=[ \t\n]|$)([^\n]*)`,
	"g",
);
// Command words after separators, simple wrappers, and leading assignments.
const COMMAND_WORD = new RegExp(
	String.raw`(?:^|[\n;&|(){}!\`]|\$\()[ \t]*(?:(?:then|do|else|elif|if|while|until|exec|command|builtin|env|nohup|time|sudo|nice)[ \t]+)*(?:[A-Za-z_]\w*\+?=\S*[ \t]+)*(${WORD})`,
	"g",
);
const VERB = /(?<![\w./-])(?:sign|submit)(?![\w./-])/g;
// A verb followed by a Proposal id in the same simple command, whatever runs it.
const VERB_WITH_ID =
	/(?<![\w./-])(?:sign|submit)(?![\w./-])[^\n;&|]*?(?<![\w-])[pc]-[1-9]\d*(?![\w-])/g;
const MOB_MENTION = /(?<![A-Za-z])mob(?![A-Za-z])/i;
const PROTECTED_KEYS =
	"policy|api_base|strategy_api_base|auth_base|app_base|key_store|walletconnect_project_id";
// Constructs that run text the guard cannot read as a literal command.
const RUNNERS: [RegExp, string][] = [
	[/(?<![\w./-])eval(?![\w./-])/, "eval"],
	[/(?<![\w./-])xargs(?![\w./-])/, "xargs"],
	[
		/(?<![\w./-])(?:ba|z|da|k|fi)?sh[ \t]+(?:-{1,2}[\w-]+[ \t]+)*-[A-Za-z]*c(?![\w-])/,
		"a shell -c string",
	],
	[/(?:^|[\n;&|(){}!])[ \t]*(?:source|\.)[ \t]+\S/, "source"],
	[/\|[ \t]*(?:\S*\/)?(?:ba|z|da|k|fi)?sh(?![\w./-])/, "a pipe into a shell"],
];
// Runners that execute decoded text directly; xargs and source of a file are
// common in unrelated commands, so only these count next to a decoder.
const SHELL_RUNNERS = [RUNNERS[0], RUNNERS[2], RUNNERS[4]];
const DECODER = /(?<![\w./-])(?:base64|basenc|xxd|openssl)(?![\w./-])/;
const INDIRECTION: [RegExp, string][] = [
	...RUNNERS,
	[DECODER, "decoding"],
	[
		/(?<![\w-])[\w-]+[ \t]*\([ \t]*\)[ \t]*\{|(?<![\w./-])function[ \t]+\w/,
		"a shell function",
	],
];

// Programs that run their stdin, or another command, as shell.
const SHELL_RECEIVERS =
	/^(?:(?:ba|z|da|k|fi|a|mk|tc|c|y)?sh|busybox|eval|source|\.|exec|env|sudo|doas|su|command|builtin|nohup|time|nice|timeout|xargs|ssh|script|parallel|watch)$/;

/**
 * The command with the body of each data heredoc blanked. A heredoc with a
 * quoted delimiter is literal stdin: the shell expands nothing in it. Fed to
 * a program that is not a shell, such as python3, jq or mob mcp, its body is
 * data, so the checks of shell structure skip it; the sign and submit counts
 * still read it. Any doubt keeps the whole command: a line outside the bodies
 * that the guard cannot read simply, or a body line that ends in a backslash.
 */
function withoutDataHeredocs(command: string): string {
	const lines = command.split("\n");
	const kept: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i++];
		kept.push(line);
		const docs = heredocs(line);
		if (!docs) return command;
		for (const doc of docs)
			while (i < lines.length) {
				const body = lines[i++];
				const done = (doc.dash ? body.replace(/^\t+/, "") : body) === doc.end;
				if (!done && body.endsWith("\\")) return command;
				kept.push(doc.data && !done ? "" : body);
				if (done) break;
			}
	}
	return kept.join("\n");
}

/**
 * The heredocs a line opens, in order; null for a line with a construct that
 * can hide quotes or commands: substitutions, `${…}`, `$'…'`, an alias, a
 * string left open, or a backslash at the end.
 */
function heredocs(line: string) {
	if (/\$[('{]|`|\\$|(?<![\w./-])alias(?![\w./-])/.test(line)) return null;
	const found: { end: string; dash: boolean; data: boolean }[] = [];
	let quote = "";
	let start = 0;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (quote) {
			if (c === quote) quote = "";
			else if (c === "\\" && quote === '"') i++;
			continue;
		}
		if (c === "\\") i++;
		else if (c === "'" || c === '"') quote = c;
		else if (c === "#" && (i === 0 || /[\s;&|()]/.test(line[i - 1]))) break;
		else if (";&|(){}".includes(c)) start = i + 1;
		else if (line.startsWith("<<<", i)) i += 2;
		else if (line.startsWith("<<", i)) {
			const match =
				/^<<(-?)[ \t]*(?:'([\w.-]+)'|"([\w.-]+)"|\\([\w.-]+)|([\w.-]+)(?![^\s;&|<>()]))/.exec(
					line.slice(i),
				);
			if (!match) return null;
			const end = match[2] ?? match[3] ?? match[4];
			// The program: the first word of this simple command, after assignments.
			const program =
				line
					.slice(start, i)
					.trim()
					.split(/[ \t]+/)
					.find((part) => !/^[A-Za-z_]\w*\+?=/.test(part)) ?? "";
			found.push({
				end: end ?? match[5],
				dash: match[1] === "-",
				data:
					end !== undefined &&
					/^(?:[\w.~-]*\/)*[A-Za-z_][\w.+-]*$/.test(program) &&
					!SHELL_RECEIVERS.test(program.split("/").pop() ?? ""),
			});
			i += match[0].length - 1;
		}
	}
	return quote ? null : found;
}

// Shell words with their quotes, and the operators that end a simple command.
const SHELL_TOKEN =
	/(?:'[^']*'|"(?:\\.|[^"\\])*"|\\.|[^\s'"\\;&|<>()])+|[;&|<>()\n]/g;

/** True when a shell word, quotes removed, names mob or its dev entry. */
function namesMob(token: string): boolean {
	const value = token.replace(/\\(.)/g, "$1").replace(/["']/g, "");
	return (
		new RegExp(`(?:^|/)mob${VERSION}$`, "i").test(value) ||
		/^\$\{?MOB(?:_BIN)?\}?$/.test(value) ||
		/(?:^|\/)apps\/cli\/src\/main\.ts$/.test(value)
	);
}

/** True when a command word runs mob without an expansion the guard cannot read. */
function mobWord(word: string): boolean {
	if (/^'[^']*'$/.test(word)) return LITERAL_PATH.test(word.slice(1, -1));
	if (/^"[^"]*"$/.test(word)) return QUOTED_PATH.test(word.slice(1, -1));
	return BARE_PATH.test(word);
}

// The hook is a guard for literal CLI invocations, not a shell sandbox. Never
// evaluate shell text or accept authorization from assistant/tool messages.
// The hook sees every Bash command in every project, so these rules apply
// only when mob is in play (named anywhere, through MOB/MOB_BIN, or the CLI's
// dev entry) or when sign/submit is followed by a Proposal id; then anything
// outside a plain `mob sign|submit <id>` is denied.
function commandChecks(text: string, shell: string, invocations: number): void {
	// What the shell sees after quote removal: `mob 'si'gn` and `s\ign` read as sign.
	const unquote = (value: string) =>
		value.replace(/\\(.)/gs, "$1").replace(/["']/g, "");
	const flat = unquote(text);
	// The same without data heredoc bodies, for the checks of shell structure.
	const shellFlat = unquote(shell);
	const config = flat.match(
		new RegExp(
			String.raw`(?<![\w./-])config[ \t]+set[ \t]+(${PROTECTED_KEYS})(?![\w-])`,
		),
	);
	if (config)
		deny(
			`mob config set ${config[1]} changes a safety setting; ask the human to run it in their own terminal`,
		);
	if (
		/(?<![\w./-])setup(?![\w./-])/.test(flat) &&
		/(?<![\w-])--policy(?![\w-])/.test(flat)
	)
		deny(
			"mob setup --policy changes the signing policy; ask the human to run it in their own terminal",
		);
	const mentioned = (value: string) =>
		MOB_MENTION.test(value) ||
		/\$\{?MOB(?:_BIN)?\b/.test(value) ||
		/apps\/cli\/src\/main\.ts/.test(value);
	if (mentioned(flat) && /(?<![\w-])--app-base(?![\w-])/.test(flat))
		deny(
			"mob onboard --app-base saves the onboarding page URL; ask the human to run it in their own terminal",
		);
	if (
		mentioned(flat) &&
		/(?<![\w./=-])keystore[ \t]+(?:create|import|list)(?![\w-])/.test(flat)
	)
		deny(
			"mob keystore reads a wallet key and passphrase; ask the human to run it in a separate terminal window",
		);
	if (mentioned(flat) && /(?<![\w./-])upgrade(?![\w./-])/.test(flat))
		deny(
			"mob upgrade replaces the binary; ask the human to run it in their own terminal",
		);
	const environment = /(?<![\w$])(?:MSTACK_\w*|MOB_HOME)\+?=\S*/g;
	const unset = flat.replace(environment, "");
	// A read such as `MSTACK_VERBOSE=1 mob doctor` is fine; a mutation is not,
	// because the guard checked policy and consent for its own home and binary.
	const mutates =
		VERB.test(unset) ||
		/(?<![\w./-])(?:config|setup|upgrade|onboard|keys|keystore|grant|approver|reject|restage|risk-ack)(?![\w./-])/.test(
			unset,
		);
	VERB.lastIndex = 0;
	if (unset !== flat && mentioned(unset) && mutates)
		deny(
			"MSTACK_* and MOB_HOME change which mob runs and where it keeps state; do not set them in a command that runs mob",
		);
	for (const match of text.matchAll(
		/(?<![\w$])MOB(?:_BIN)?\+?=("[^"\n]*"|'[^'\n]*'|[^\s;&|]*)/g,
	)) {
		const value = match[1].replace(/^(["'])(.*)\1$/, "$2");
		if (
			!/^\$\((?:command -v|which) mob\)$/.test(value) &&
			!BARE_PATH.test(value)
		)
			deny("set MOB or MOB_BIN only to a literal path that ends in /mob");
	}
	if (
		DECODER.test(shellFlat) &&
		SHELL_RUNNERS.some(([pattern]) => pattern.test(shellFlat))
	)
		deny("decoded text cannot run as shell commands");
	const verbs = [...flat.matchAll(VERB)].length;
	const targeted = [...flat.matchAll(VERB_WITH_ID)].length > 0;
	const inPlay = mentioned(flat);
	if (!inPlay && !targeted) return;
	for (const [pattern, name] of INDIRECTION)
		if (pattern.test(shellFlat))
			deny(
				`${name} cannot be combined with mob, sign, or submit; run mob as its own plain command`,
			);
	// The mob command itself must be a literal word: `mob ${v}mit` and
	// `mob s?bmit` hide the verb the counts look for. Redirections such as
	// `2>/dev/null` or `&>log` can come first, so they are skipped.
	const tokens = shell.match(SHELL_TOKEN) ?? [];
	const redirect = (at: number) =>
		tokens[at] === ">" ||
		tokens[at] === "<" ||
		(tokens[at] === "&" && tokens[at + 1] === ">");
	tokens.forEach((token, index) => {
		if (!namesMob(token)) return;
		let at = index + 1;
		while (at < tokens.length) {
			const next = tokens[at];
			if (/^\d+$/.test(next) && redirect(at + 1)) {
				at++;
				continue;
			}
			if (redirect(at)) {
				while (/^[<>&]$/.test(tokens[at] ?? "")) at++;
				at++; // the target
				continue;
			}
			if (/^[;&|<>()\n]$/.test(next)) break;
			if (/[$`*?[\]{}]/.test(next.replace(/'[^']*'/g, "")))
				deny(
					`name the mob command with a literal word, not an expansion or pattern (${next})`,
				);
			if (!next.replace(/["'\\]/g, "").startsWith("-")) break;
			at++;
		}
	});
	for (const match of shell.matchAll(COMMAND_WORD))
		if (/^["']?[$`]/.test(match[1]) && !mobWord(match[1]))
			deny(
				`a command name from a variable (${match[1]}) cannot be combined with mob, sign, or submit`,
			);
	if (verbs !== invocations)
		deny(
			"`sign` or `submit` appears outside a plain `mob sign|submit <id>` command; run it as its own command",
		);
}

async function check(raw: string, home: string): Promise<void> {
	const input = JSON.parse(raw);
	const command: unknown = input?.tool_input?.command;
	if (typeof command !== "string") deny("missing Bash command in hook input");
	const text = command.replace(/\\\r?\n/g, "");
	const shell = withoutDataHeredocs(command).replace(/\\\r?\n/g, "");
	const invocations = [...text.matchAll(INVOCATION)].filter((match) =>
		mobWord(match[1]),
	);
	const requests = invocations.map((match) => {
		const action = match[3] as "sign" | "submit";
		const tokens =
			match[4]
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
				action === "sign"
					? /^[pc]-[1-9]\d*$/.test(token)
					: /^p-[1-9]\d*$/.test(token);
			if (!validId) deny("use one literal Proposal id in each sign command");
			ids.push(token);
		}
		if (ids.length !== 1)
			deny("use one literal Proposal id in each sign command");
		return { action, id: ids[0] };
	});
	commandChecks(text, shell, requests.length);
	if (!requests.length) return;
	await readFile(join(home, "config.json"), "utf8").catch(() =>
		deny("missing or unreadable config; cannot verify policy"),
	);
	const config = await readConfig(home).catch(() =>
		deny("missing or unreadable config; cannot verify policy"),
	);
	const policy = config.policy ?? "manual";
	if (policy === "locked") deny("policy is locked");
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
	const latest = latestHumanInput(
		readFileSync(input.transcript_path, "utf8")
			.split("\n")
			.filter((line) => line.trim())
			.map((line) => JSON.parse(line)),
	);
	for (const { id, action } of requests) {
		if (latest.kind === "none")
			deny(`${latest.reason}; the human must say "${action} ${id}"`);
		if (latest.kind === "text") {
			if (!textConsent(latest.text, action, id))
				deny(
					`the latest user message must say "${action} ${id}" without a negation`,
				);
			continue;
		}
		const verb = action === "sign" ? "Sign" : "Submit";
		if (
			!latest.labels.some((label) =>
				new RegExp(`^\\s*${verb}\\s+${id}(?![\\w-])`, "i").test(label),
			)
		)
			deny(
				`the answer you chose must be an offered option that starts with "${verb} ${id}"`,
			);
	}
}

type Latest =
	| { kind: "none"; reason: string }
	| { kind: "text"; text: string }
	| { kind: "answers"; labels: string[] };

/**
 * The latest human input: a message Claude Code marks as human-typed, or the
 * options the human chose from an AskUserQuestion the assistant asked. Tool
 * output, task notifications, compact summaries, command output, and meta
 * events are data. Anything else unrecognized revokes consent.
 */
function latestHumanInput(events: unknown[]): Latest {
	// Claude Code marks human input with origin/promptSource. Transcripts
	// without any marker predate it; there, plain untagged text is human.
	const marked = events.some(
		(event) =>
			isObject(event) &&
			event.type === "user" &&
			(event.origin !== undefined || event.promptSource !== undefined),
	);
	const asked = new Map<string, unknown>();
	let latest: Latest = { kind: "none", reason: "no user message" };
	for (const event of events) {
		if (!isObject(event) || event.isSidechain || event.isSideChain) continue;
		const message = isObject(event.message) ? event.message : undefined;
		if (event.type === "assistant") {
			if (Array.isArray(message?.content))
				for (const part of message.content)
					if (
						isObject(part) &&
						part.type === "tool_use" &&
						part.name === "AskUserQuestion" &&
						typeof part.id === "string"
					)
						asked.set(
							part.id,
							isObject(part.input) ? part.input.questions : undefined,
						);
			continue;
		}
		if (
			event.type !== "user" ||
			event.isMeta ||
			event.isCompactSummary ||
			event.isVisibleInTranscriptOnly
		)
			continue;
		if (message?.role !== "user")
			deny("invalid latest user message in transcript");
		const content = message.content;
		const parts: unknown[] =
			typeof content === "string"
				? [{ type: "text", text: content }]
				: Array.isArray(content)
					? content
					: deny("invalid latest user message in transcript");
		const results = parts.filter(
			(part) => isObject(part) && part.type === "tool_result",
		) as Record<string, unknown>[];
		if (results.length) {
			const answers = results.filter((result) =>
				asked.has(result.tool_use_id as string),
			);
			// Ordinary tool output is data and never replaces consent.
			if (!answers.length && results.length === parts.length) continue;
			// Text merged into a tool result has no human marker: fail closed.
			latest =
				answers.length === 1 && parts.length === 1
					? {
							kind: "answers",
							labels: chosenLabels(
								asked.get(answers[0].tool_use_id as string),
								event.toolUseResult,
								answers[0].is_error === true,
							),
						}
					: { kind: "none", reason: "unrecognized user event" };
			continue;
		}
		const text = parts
			.filter(
				(part) =>
					isObject(part) &&
					part.type === "text" &&
					typeof part.text === "string",
			)
			.map((part) => (part as { text: string }).text)
			.join("\n");
		const origin = isObject(event.origin) ? event.origin.kind : event.origin;
		if (origin === "task-notification") continue;
		if (origin === "human") {
			const human = text
				.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
				.trim();
			if (/^<[a-z][\w-]*>/.test(human)) continue; // bash-input and similar
			latest = ["typed", "queued", "sdk", undefined].includes(
				event.promptSource as string | undefined,
			)
				? { kind: "text", text: human }
				: { kind: "none", reason: "the latest message was not typed" };
			continue;
		}
		if (origin !== undefined) {
			latest = { kind: "none", reason: "unrecognized user event" };
			continue;
		}
		// Claude Code's own markers: command output, notifications, interrupts.
		if (/^\s*<[a-z][\w-]*>/.test(text)) continue;
		latest =
			marked || text.startsWith("[Request interrupted")
				? { kind: "none", reason: "the latest message is not marked human" }
				: { kind: "text", text };
	}
	return latest;
}

/** The offered labels the human chose, read from Claude Code's structured answers. */
function chosenLabels(
	questions: unknown,
	record: unknown,
	failed: boolean,
): string[] {
	const answers = isObject(record) ? record.answers : undefined;
	if (failed || !Array.isArray(questions) || !isObject(answers)) return [];
	// Assistant text shaped like an answer pair is a spoofing attempt.
	const strings = (value: unknown): string[] =>
		typeof value === "string"
			? [value]
			: isObject(value) || Array.isArray(value)
				? Object.values(value).flatMap(strings)
				: [];
	if (strings(questions).some((value) => value.includes('"='))) return [];
	const labels: string[] = [];
	for (const question of questions) {
		if (
			!isObject(question) ||
			typeof question.question !== "string" ||
			!Array.isArray(question.options) ||
			question.multiSelect === true ||
			!Object.hasOwn(answers, question.question)
		)
			continue;
		const answer = answers[question.question];
		// A free-text "Other" answer is not marked as typed, so it is not consent.
		if (
			question.options.some(
				(option) => isObject(option) && option.label === answer,
			)
		)
			labels.push(answer as string);
	}
	return labels;
}

/** The verb right before the exact id, with no negation in the three words before it. */
function textConsent(
	text: string,
	action: "sign" | "submit",
	id: string,
): boolean {
	const verb = action === "sign" ? "sign(?:ing)?" : "submit(?:ting)?";
	const matches = [
		...text.matchAll(new RegExp(`(?<![\\w-])${verb}\\s+${id}(?![\\w-])`, "gi")),
	];
	return (
		matches.length > 0 &&
		matches.every((match) => {
			const words =
				text
					.slice(0, match.index)
					.toLowerCase()
					.match(/[a-z]+(?:['’][a-z]+)?/g) ?? [];
			return !words
				.slice(-3)
				.some(
					(word) =>
						["not", "no", "never", "cancel", "reject", "stop", "dont"].includes(
							word,
						) || /n['’]t$/.test(word),
				);
		})
	);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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
