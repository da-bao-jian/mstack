// Gated QA of the streamlined signing and onboarding UX through a real Claude
// Code session: the plugin is loaded from this checkout, `mob` runs against a
// sandbox home that points at local fake Mobius servers, and the transcript is
// checked for what the agent ran and asked. Run with: MOB_QA=1 bun run qa:signing
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fakePositionServer } from "../apps/cli/test/fixtures/fake-funding-server.ts";
import { createKeyStore } from "../packages/keys/src/index.ts";
import { fakeStrategyApi } from "../packages/mobius-api/test/fake-api.ts";

const root = resolve(import.meta.dir, "..");
if (process.env.MOB_QA !== "1") {
	console.log("qa:signing skipped: set MOB_QA=1 to run against claude -p");
	process.exit(0);
}
if (!Bun.which("claude")) {
	console.error("qa:signing requires the claude CLI on PATH");
	process.exit(1);
}

type Event = { type?: string; message?: { content?: unknown } };
type ToolUse = { name: string; input: Record<string, unknown> };
function toolUses(stream: string): ToolUse[] {
	const uses: ToolUse[] = [];
	for (const line of stream.split("\n")) {
		if (!line.trim()) continue;
		let event: Event;
		try {
			event = JSON.parse(line) as Event;
		} catch {
			continue;
		}
		const content = event.message?.content;
		if (!Array.isArray(content)) continue;
		for (const part of content)
			if (part?.type === "tool_use")
				uses.push({
					name: String(part.name),
					input: (part.input ?? {}) as Record<string, unknown>,
				});
	}
	return uses;
}
function bashCommands(stream: string): string[] {
	return toolUses(stream)
		.filter((use) => use.name === "Bash")
		.map((use) => String(use.input.command ?? ""));
}
/** The assistant's last text reply. In headless runs AskUserQuestion may be
 * unavailable; the skills then ask in prose and the human types the id. */
function finalText(stream: string): string {
	let text = "";
	for (const line of stream.split("\n")) {
		if (!line.trim()) continue;
		let event: Event;
		try {
			event = JSON.parse(line) as Event;
		} catch {
			continue;
		}
		const content = event.message?.content;
		if (event.type !== "assistant" || !Array.isArray(content)) continue;
		for (const part of content)
			if (part?.type === "text" && typeof part.text === "string")
				text = part.text;
	}
	return text;
}
function askedFor(stream: string, verb: "Sign" | "Submit", id: RegExp): string {
	const labels = questionLabels(stream);
	const pattern = new RegExp(`^${verb} ${id.source}`);
	if (labels.some((l) => pattern.test(l)))
		return `label: ${labels.join(" / ")}`;
	const text = finalText(stream);
	const idInText = new RegExp(`\\b${id.source}\\b`).test(text);
	const stopped =
		/did not (?:submit|sign)|not submitted|nothing has been submitted|waiting for your|stopped before|only run .{0,40}(?:submit|sign)|names? (?:the id|p-|c-)|reply `?(?:submit|sign) /i.test(
			text,
		);
	const offered = new RegExp(`^\\s*[-*]?\\s*${verb} ${id.source}\\b`, "m").test(
		text,
	);
	if (idInText && (stopped || offered))
		return `prose: ${text.slice(0, 160).replace(/\n/g, " ")}`;
	return "";
}
function questionLabels(stream: string): string[] {
	return toolUses(stream)
		.filter((use) => use.name === "AskUserQuestion")
		.flatMap((use) => {
			const questions = (use.input.questions ?? []) as {
				options?: { label?: string }[];
			}[];
			return questions.flatMap((q) =>
				(q.options ?? []).map((o) => String(o.label ?? "")),
			);
		});
}

const strategy = fakeStrategyApi();
const fakeFunding = fakePositionServer(strategy.owner.address, () =>
	Date.now(),
);
const home = await mkdtemp(join(tmpdir(), "mstack-qa-home-"));
const work = await mkdtemp(join(tmpdir(), "mstack-qa-work-"));
const results: { name: string; ok: boolean; detail: string }[] = [];

// A fake auth server for the legal clickwrap, and a funding proxy whose
// readiness follows the fake Strategy API's bound venues and which answers
// key creation with the key that fake API accepts.
const legal = { accepted: false };
const auth = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(req) {
		const url = new URL(req.url);
		if (url.pathname === "/legal/terms")
			return Response.json({
				termsVersion: "2026-10-12",
				termsUrl: "https://mob.exchange/terms",
				privacyVersion: "2026-10-12",
				privacyUrl: "https://mob.exchange/privacy",
			});
		if (url.pathname === "/legal/acceptance" && req.method === "POST") {
			const body = (await req.json()) as { signature?: unknown };
			if (typeof body.signature !== "string")
				return Response.json({ error: "no signature" }, { status: 400 });
			legal.accepted = true;
			return Response.json({ ok: true });
		}
		if (url.pathname === "/legal/acceptance")
			return Response.json({
				accepted: legal.accepted,
				termsVersion: "2026-10-12",
				privacyVersion: "2026-10-12",
				acceptedAt: legal.accepted ? "2026-10-12T00:00:00.000Z" : null,
			});
		return Response.json({ error: "not found" }, { status: 404 });
	},
});
const funding = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(req) {
		const url = new URL(req.url);
		if (url.pathname.endsWith("/health")) return Response.json({ ok: true });
		if (url.pathname === "/api/client-ip")
			return Response.json({ ip: "127.0.0.1" });
		if (url.pathname === "/api/binding/readiness")
			return Response.json({
				ready: strategy.bound.has("hl") && strategy.bound.has("lighter"),
				venues: ["hl", "lighter"].map((venue) => ({
					venue,
					ready: strategy.bound.has(venue as "hl" | "lighter"),
					bound: strategy.bound.has(venue as "hl" | "lighter"),
				})),
			});
		if (url.pathname === "/api/keys/create" && req.method === "POST") {
			const body = (await req.json()) as Record<string, unknown>;
			if (typeof body.signature !== "string")
				return Response.json({ error: "no signature" }, { status: 400 });
			return Response.json({
				key: strategy.key,
				record: {
					id: "01234567-89ab-cdef-0123-456789abcdef",
					name: body.name,
					venues: body.venues,
					max_size_usd: String(body.maxSizeUsd),
					key_prefix: `${String(strategy.key).slice(0, 44)}…`,
					created_at: "2030-01-01T00:00:00Z",
					revoked_at: null,
				},
			});
		}
		return fetch(`${fakeFunding.base}${url.pathname}${url.search}`, {
			method: req.method,
			headers: req.headers,
			body:
				req.method === "GET" || req.method === "HEAD"
					? undefined
					: await req.text(),
		});
	},
});
const authBase = `http://127.0.0.1:${auth.port}`;
const fundingBase = `http://127.0.0.1:${funding.port}`;

async function session(name: string, prompt: string, turns: number) {
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
			String(turns),
			"--permission-mode",
			"dontAsk",
			"--allowedTools",
			"Bash,Read,AskUserQuestion,Skill",
			"--disallowedTools",
			"Edit,Write,WebFetch,WebSearch",
		],
		{
			cwd: work,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, MOB_HOME: home, MOB_NO_OPEN: "1" },
		},
	);
	const [code, out, err] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	await writeFile(join(work, `${name}.jsonl`), out);
	return { code, out, err };
}

function record(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "pass" : "FAIL"}  ${name}: ${detail}`);
}

const signPattern = /\b(?:mob|\$MOB|\$\{MOB\}|MOB_BIN)["']?\s+sign\b/;
const submitPattern = /\b(?:mob|\$MOB|\$\{MOB\}|MOB_BIN)["']?\s+submit\b/;

try {
	await writeFile(
		join(home, "config.json"),
		`${JSON.stringify(
			{
				owner: strategy.owner.address,
				signer: "browser",
				policy: "manual",
				key_store: "file",
				api_base: fundingBase,
				strategy_api_base: strategy.base,
				auth_base: authBase,
			},
			null,
			2,
		)}\n`,
		{ mode: 0o600 },
	);

	// QA 1: with nothing bound and the terms not accepted, onboarding stages one
	// ceremony and asks with "Sign c-N" labels; no sign runs.
	const onboard = await session(
		"onboard",
		`set me up with hl and lighter on Robinhood Chain (venue id lighter, not lighter-mainnet), cap $2,000 per leg. My owner address is ${strategy.owner.address}.`,
		8,
	);
	const onboardBash = bashCommands(onboard.out);
	record(
		"onboard: stages the native ceremony",
		onboardBash.some((c) => /onboard\s+--native/.test(c)),
		onboardBash.filter((c) => /onboard/.test(c)).join(" | ") ||
			"(no onboard command)",
	);
	const onboardAsk = askedFor(onboard.out, "Sign", /c-\d+/);
	record(
		"onboard: asks for Sign c-N consent (label or prose)",
		Boolean(onboardAsk),
		onboardAsk || "(no question)",
	);
	record(
		"onboard: never runs mob sign unprompted",
		!onboardBash.some((c) => signPattern.test(c)),
		onboardBash.some((c) => signPattern.test(c))
			? "ran mob sign"
			: "no sign call",
	);

	// QA 2: with a stored key, bound venues, accepted terms, and the risk
	// interview acknowledged today, an open request that names both legs and
	// the size stages at once and asks "Submit p-N now".
	legal.accepted = true;
	strategy.bound.add("hl");
	strategy.bound.add("lighter");
	await (await createKeyStore({ home, selection: "file" })).put(
		strategy.owner.address,
		strategy.key,
		{
			venues: ["hl", "lighter", "lighter-mainnet", "aster"],
			maxSizeUsd: 10_000,
			importedAt: Date.now(),
			verifiedAt: Date.now(),
			apiBase: strategy.base,
		},
	);
	await writeFile(
		join(home, "risk-interview.json"),
		`${JSON.stringify({ owner: strategy.owner.address, acknowledgedAt: Date.now() })}\n`,
		{ mode: 0o600 },
	);
	const open = await session(
		"open",
		"open $1,000 BTC long hl:BTC short lighter:BTC, protection off, auto-close off",
		8,
	);
	const openBash = bashCommands(open.out);
	const openLabels = questionLabels(open.out);
	const staged = openBash.some((c) => /\bopen\s+BTC\b/.test(c));
	record(
		"open: stages without asking for legs or size",
		staged && !openLabels.some((l) => /\$1,000|\$5,000|\$25,000/.test(l)),
		openBash.filter((c) => /\bopen\b/.test(c)).join(" | ") ||
			"(no open command)",
	);
	const openAsk = askedFor(open.out, "Submit", /p-\d+/);
	record(
		"open: asks for Submit p-N consent (label or prose)",
		Boolean(openAsk),
		openAsk || "(no question)",
	);
	record(
		"open: never submits without consent",
		!openBash.some((c) => submitPattern.test(c)),
		openBash.some((c) => submitPattern.test(c))
			? "ran mob submit"
			: "no submit call",
	);
	record(
		"open: skips the risk interview when acknowledged today",
		staged && !openLabels.some((l) => /funding flip|liquidation/i.test(l)),
		staged ? "no interview question" : "did not stage",
	);
} finally {
	strategy.stop();
	fakeFunding.stop();
	auth.stop(true);
	funding.stop(true);
	await rm(home, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok).length;
console.log(
	`${results.length - failed}/${results.length} QA checks passed; transcripts in ${work}`,
);
process.exit(failed ? 1 : 0);
