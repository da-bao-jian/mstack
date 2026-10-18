// Gated QA of the streamlined signing and onboarding UX through a real Claude
// Code session: the plugin is loaded from this checkout, `mob` runs against a
// sandbox home that points at local fake Mobius servers, and the transcript is
// checked for what the agent ran and asked. The second half starts a real
// `mob approver` on a pseudo-terminal (expect plays the human) and drives the
// approver and session-grant flows end to end. Run with:
// MOB_QA=1 bun run qa:signing
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fakePositionServer } from "../apps/cli/test/fixtures/fake-funding-server.ts";
import { createKeyStore } from "../packages/keys/src/index.ts";
import {
	fakeOwnerKey,
	fakeStrategyApi,
	signedByFakeOwner,
} from "../packages/mobius-api/test/fake-api.ts";
import { buildAgentGrantMessage } from "../packages/mobius-client/src/index.ts";
import { importKeystore } from "../packages/signers/src/index.ts";

const root = resolve(import.meta.dir, "..");
if (process.env.MOB_QA !== "1") {
	console.log("qa:signing skipped: set MOB_QA=1 to run against claude -p");
	process.exit(0);
}
if (!Bun.which("claude")) {
	console.error("qa:signing requires the claude CLI on PATH");
	process.exit(1);
}
if (!Bun.which("expect")) {
	console.error("qa:signing requires expect on PATH for the approver QA");
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
		/did not (?:submit|sign)|not (?:submitted|signed)|nothing (?:has been|is) (?:submitted|signed)|waiting for your|stopped before|only run .{0,40}(?:submit|sign)|nam(?:es?|ing) (?:the id|p-|c-)|go-ahead|reply (?:with )?[`"'“]?(?:submit|sign) /i.test(
			text,
		);
	const offered = new RegExp(
		`^\\s*(?:[-*]|\\d+\\.)?\\s*[*_"'“]*${verb} ${id.source}\\b`,
		"m",
	).test(text);
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
// The agent's cwd stays empty; transcripts and the human's terminal log live apart.
const work = await mkdtemp(join(tmpdir(), "mstack-qa-work-"));
const logs = await mkdtemp(join(tmpdir(), "mstack-qa-logs-"));
const results: { name: string; ok: boolean; detail: string }[] = [];
const mob = join(root, "bin", "mob");

// A fake auth server for the legal clickwrap, and a funding proxy whose
// readiness follows the fake Strategy API's bound venues, which answers key
// creation with the key that fake API accepts, and which implements the
// proposed agent-grant routes with real signature verification.
const legal = { accepted: false };
const grants: Record<string, unknown>[] = [];
const revoked: string[] = [];
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
		if (url.pathname === "/api/agent-grants" && req.method === "GET")
			return Response.json(grants);
		if (url.pathname === "/api/agent-grants/create" && req.method === "POST") {
			const body = (await req.json()) as Record<string, unknown>;
			const message = buildAgentGrantMessage(
				body as unknown as Parameters<typeof buildAgentGrantMessage>[0],
			);
			const valid = await signedByFakeOwner(message, String(body.signature));
			if (!valid)
				return Response.json({ error: "bad signature" }, { status: 401 });
			const grant = {
				grantId: `g-${grants.length + 1}`,
				owner: strategy.owner.address,
				agent: body.agent,
				scopes: body.scopes,
				maxOpenNotionalUsd: body.maxOpenNotionalUsd,
				maxOpenTasks: body.maxOpenTasks,
				venues: body.venues,
				markets: body.markets,
				expiresAt: new Date(Number(body.expires) * 1000).toISOString(),
				revokedAt: null,
			};
			grants.push(grant);
			return Response.json({ grant });
		}
		if (url.pathname === "/api/agent-grants/revoke" && req.method === "POST") {
			const body = (await req.json()) as Record<string, unknown>;
			const valid = await signedByFakeOwner(
				`Revoke Mobius agent: agent=${String(body.agent).toLowerCase()} timestamp=${body.timestamp}`,
				String(body.signature),
			);
			if (!valid)
				return Response.json({ error: "bad signature" }, { status: 401 });
			revoked.push(String(body.agent));
			return Response.json({ ok: true });
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

async function writeConfig(signer: "browser" | "keystore") {
	await writeFile(
		join(home, "config.json"),
		`${JSON.stringify(
			{
				owner: strategy.owner.address,
				signer,
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
}

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
	await writeFile(join(logs, `${name}.jsonl`), out);
	return { code, out, err };
}

/** Runs mob the way an agent's shell does: no TTY, no passphrase. */
async function shell(args: string[]) {
	const child = Bun.spawn([mob, ...args], {
		cwd: work,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, MOB_HOME: home, MOB_NO_OPEN: "1" },
	});
	const [code, out, err] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { code, out, err };
}

function record(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "pass" : "FAIL"}  ${name}: ${detail}`);
}

const signPattern = /\b(?:mob|\$MOB|\$\{MOB\}|MOB_BIN)["']?\s+sign\b/;
const submitPattern = /\b(?:mob|\$MOB|\$\{MOB\}|MOB_BIN)["']?\s+submit\b/;

// The approver runs under expect for the second half of the QA.
const password = "qa approver passphrase";
const answerFile = join(logs, "approver-answer.txt");
const approverLog = join(logs, "approver.log");
const pidFile = join(logs, "approver.pid");
let approver: ReturnType<typeof Bun.spawn> | undefined;
async function approverPid(): Promise<number> {
	return Number((await readFile(pidFile, "utf8")).trim());
}
async function approverRunning(): Promise<boolean> {
	const hello = await shell(["hello", "--json", "--offline"]);
	try {
		return JSON.parse(hello.out).approver?.running === true;
	} catch {
		return false;
	}
}

try {
	await writeConfig("browser");

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

	// QA 3: the approver. The human imports the keystore (their own step),
	// starts `mob approver` in a terminal (expect plays that terminal), and the
	// agent, which has no TTY, hands ids over instead of asking for a switch.
	const creation = [fakeOwnerKey, password, password];
	await importKeystore(home, async () => creation.shift() ?? "");
	await writeConfig("keystore");
	await writeFile(answerFile, "y\n");
	approver = Bun.spawn(
		["expect", "-f", join(root, "scripts", "qa-approver.exp")],
		{
			cwd: work,
			stdin: "ignore",
			stdout: "ignore",
			stderr: "pipe",
			env: {
				...process.env,
				MOB_HOME: home,
				MOB_BIN: mob,
				QA_PASSPHRASE: password,
				QA_ANSWER_FILE: answerFile,
				QA_APPROVER_LOG: approverLog,
				QA_PID_FILE: pidFile,
			},
		},
	);
	let running = false;
	for (let attempt = 0; attempt < 60 && !running; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 500));
		running = await approverRunning();
	}
	const approverBanner = await readFile(approverLog, "utf8").catch(() => "");
	record(
		"approver: starts on a terminal, unlocks once, and hello reports it",
		running && /Approver running for/.test(approverBanner),
		running
			? (approverBanner.split("\n").find((l) => /Approver running/.test(l)) ??
					"running")
			: `not running; log: ${approverBanner.slice(-300)}`,
	);

	// A fresh ceremony: terms not accepted, nothing bound, key to create.
	legal.accepted = false;
	strategy.bound.clear();
	const stagedCeremony = await shell([
		"onboard",
		"--native",
		"--owner",
		strategy.owner.address,
		"--venues",
		"hl,lighter",
		"--max-size",
		"2000",
	]);
	const ceremonyId = stagedCeremony.out.match(/\b(c-\d+)\b/)?.[1] ?? "";
	record(
		"approver: a ceremony is staged for the approver QA",
		stagedCeremony.code === 0 && Boolean(ceremonyId),
		ceremonyId || `${stagedCeremony.out}\n${stagedCeremony.err}`.slice(-300),
	);
	const sign = await session(
		"sign-ceremony",
		`Sign ${ceremonyId} in my approver terminal.`,
		8,
	);
	const signBash = bashCommands(sign.out);
	const signCalls = signBash.filter((c) => signPattern.test(c));
	record(
		"approver: the agent hands the named ceremony to the approver once",
		signCalls.length === 1 &&
			new RegExp(`sign\\s+["']?${ceremonyId}["']?(?:\\s|$)`).test(
				signCalls[0] ?? "",
			),
		signCalls.join(" | ") || "(no sign call)",
	);
	const ceremonyShow = await shell(["proposal", "show", ceremonyId, "--json"]);
	let ceremonyStatus = "";
	try {
		ceremonyStatus = String(JSON.parse(ceremonyShow.out).status);
	} catch {}
	const approverSaw = await readFile(approverLog, "utf8").catch(() => "");
	record(
		"approver: the ceremony completed through the human's y (legal, bind, key)",
		ceremonyStatus === "complete" &&
			legal.accepted &&
			strategy.bound.has("hl") &&
			strategy.bound.has("lighter") &&
			new RegExp(`Request to sign ${ceremonyId}`).test(approverSaw),
		`status ${ceremonyStatus || "unknown"}; legal ${legal.accepted}; bound ${[...strategy.bound].join(",") || "none"}`,
	);
	record(
		"approver: the agent never sees a passphrase prompt",
		!/Passphrase for/.test(sign.out),
		/Passphrase for/.test(sign.out)
			? "passphrase prompt in transcript"
			: "clean",
	);
	const signText = finalText(sign.out);
	record(
		"approver: the agent reports the outcome",
		new RegExp(`\\b${ceremonyId}\\b`).test(signText) &&
			/ready|complete|signed|bound/i.test(signText),
		signText.slice(0, 160).replace(/\n/g, " ") || "(no reply)",
	);

	// QA 4: session grants through the approver, from an agent-like shell.
	const grantCreate = await shell([
		"grant",
		"create",
		"--scopes",
		"open,close",
		"--max-notional",
		"500",
		"--max-tasks",
		"2",
		"--venues",
		"hl,lighter",
		"--markets",
		"NVDA,BTC",
	]);
	const grantId = grantCreate.out.match(/\b(p-\d+)\b/)?.[1] ?? "";
	record(
		"grant: create stages the owner-signed authorization",
		grantCreate.code === 0 &&
			Boolean(grantId) &&
			/Authorize Mobius agent:/.test(grantCreate.out),
		grantId || `${grantCreate.out}\n${grantCreate.err}`.slice(-300),
	);
	const grantSign = await shell(["sign", grantId]);
	record(
		"grant: an agent-side mob sign is routed to the approver and the server verifies the signature",
		grantSign.code === 0 &&
			/Handed .* to your approver terminal/.test(grantSign.out) &&
			grants.length === 1 &&
			JSON.stringify((grants[0] as { markets?: unknown }).markets) ===
				'["NVDA","BTC"]' &&
			!/Passphrase for/.test(grantSign.out + grantSign.err),
		grantSign.code === 0
			? `grants recorded: ${grants.length}; markets ${JSON.stringify((grants[0] as { markets?: unknown })?.markets)}`
			: `${grantSign.out}\n${grantSign.err}`.slice(-300),
	);
	const grantShow = await shell(["grant", "show"]);
	const agentAddress = grantShow.out.match(/0x[0-9a-fA-F]{40}/)?.[0] ?? "";
	record(
		"grant: show lists the recorded grant",
		/g-1/.test(grantShow.out) && Boolean(agentAddress),
		grantShow.out.split("\n").find((l) => /g-1/.test(l)) ??
			grantShow.out.slice(-200),
	);
	// A declined card signs nothing; the same Proposal is signable afterwards.
	await writeFile(answerFile, "n\n");
	const revoke = await shell(["grant", "revoke", agentAddress]);
	const revokeId = revoke.out.match(/\b(p-\d+)\b/)?.[1] ?? "";
	const declined = await shell(["sign", revokeId]);
	record(
		"grant: a declined card signs nothing and the agent is told",
		declined.code === 1 &&
			new RegExp(`${revokeId} was declined in the approver`).test(
				declined.err,
			) &&
			revoked.length === 0,
		declined.code === 1
			? (declined.err.trim().split("\n")[0] ?? "")
			: "signed anyway",
	);
	await writeFile(answerFile, "y\n");
	const revokeSign = await shell(["sign", revokeId]);
	const shownAfter = await shell(["grant", "show"]);
	record(
		"grant: revoke signs through the approver and the record is marked",
		revokeSign.code === 0 &&
			revoked.length === 1 &&
			/g-1/.test(shownAfter.out) &&
			/\d{4}-\d{2}-\d{2}T/.test(
				shownAfter.out.split("\n").find((l) => /g-1/.test(l)) ?? "",
			),
		revokeSign.code === 0
			? (shownAfter.out.split("\n").find((l) => /g-1/.test(l)) ?? "")
			: `${revokeSign.out}\n${revokeSign.err}`.slice(-300),
	);

	// QA 5: the agent stages a grant from a plain request and asks before signing.
	const grantSession = await session(
		"grant",
		"Create a session grant so you can open and close on hl and lighter for me, with a $500 cap and at most 2 open tasks.",
		8,
	);
	const grantBash = bashCommands(grantSession.out);
	const grantCall =
		grantBash.find((c) => /\bgrant\s+create\b/.test(c) && /--scopes/.test(c)) ??
		"";
	record(
		"grant: the agent stages the grant with the requested scopes, cap, tasks and venues",
		/--scopes\s+['"]?(?:open,close|close,open)/.test(grantCall) &&
			/--max-notional\s+['"]?500\b/.test(grantCall) &&
			/--max-tasks\s+['"]?2\b/.test(grantCall) &&
			/--venues\s+['"]?(?:hl,lighter|lighter,hl)/.test(grantCall),
		grantCall || "(no grant create command)",
	);
	const grantAsk = askedFor(grantSession.out, "Sign", /p-\d+/);
	record(
		"grant: the agent asks for Sign p-N consent and never signs unprompted",
		Boolean(grantAsk) && !grantBash.some((c) => signPattern.test(c)),
		grantAsk || "(no question)",
	);

	// QA 6: Ctrl-C stops the approver and removes its socket and token.
	process.kill(await approverPid(), "SIGINT");
	await approver.exited;
	approver = undefined;
	const stoppedLog = await readFile(approverLog, "utf8").catch(() => "");
	const leftovers = await Promise.all(
		["approver.sock", "approver.token"].map((name) =>
			Bun.file(join(home, name)).exists(),
		),
	);
	record(
		"approver: Ctrl-C stops it and cleans up",
		/Approver stopped\./.test(stoppedLog) &&
			!leftovers.some(Boolean) &&
			!(await approverRunning()),
		leftovers.some(Boolean) ? "socket or token left behind" : "clean stop",
	);
} finally {
	if (approver) {
		try {
			process.kill(await approverPid(), "SIGINT");
		} catch {}
		approver.kill();
	}
	strategy.stop();
	fakeFunding.stop();
	auth.stop(true);
	funding.stop(true);
	await rm(home, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok).length;
console.log(
	`${results.length - failed}/${results.length} QA checks passed; transcripts and the approver log in ${logs}`,
);
process.exit(failed ? 1 : 0);
