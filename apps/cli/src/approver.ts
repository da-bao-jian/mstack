import { randomBytes } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
	CeremonyStore,
	ceremonyFingerprint,
	ProposalStore,
} from "@mstack/proposals";
import {
	readSecretFromTty,
	type SecretReader,
	unlockKeystore,
} from "@mstack/signers";
import { getAddress } from "viem";
import { readConfig, SETUP_FIRST, UsageError } from "./config.ts";
import { p1 } from "./p1.ts";
import type { Runtime } from "./run.ts";

/**
 * A persistent local approver for keystore users. It runs in the human's own
 * terminal, unlocks the keystore once per idle window, and signs a Proposal
 * or ceremony only after the human answers "y" to its card. The agent's
 * `mob sign <id>` hands the id over a local socket and relays the output; the
 * passphrase and the key never leave this process. The record the card shows
 * is pinned before the human decides and checked again when signing, so no
 * same-user process can swap the bytes in between. A card is withdrawn when
 * the requester disconnects before the answer.
 */

const SOCKET = "approver.sock";
const TOKEN = "approver.token";
const DEFAULT_IDLE_MS = 30 * 60 * 1000;
/** How long the agent's `mob sign` waits for the human's answer. */
const ANSWER_TIMEOUT_MS = 10 * 60 * 1000;
/** sun_path holds 104 bytes on macOS and 108 on Linux, NUL included. */
const MAX_SOCKET_PATH = 100;
const MAX_REQUEST_BYTES = 4096;
const NO_APPROVER =
	"no approver is running; start mob approver in your own terminal";

type Request = { token?: unknown; id?: unknown; ping?: unknown };
type Event =
	| { event: "out" | "err"; text: string }
	| { event: "done"; code: number }
	| { event: "pong" };
type Connection = {
	text: string;
	done: boolean;
	closed: boolean;
	withdraw?: AbortController;
};

function approverPaths(home: string) {
	return { socket: join(home, SOCKET), token: join(home, TOKEN) };
}

const idPattern = /^[pc]-[1-9]\d*$/;

function parseEvents(buffer: { text: string }, chunk: string): Event[] {
	buffer.text += chunk;
	const events: Event[] = [];
	let index = buffer.text.indexOf("\n");
	while (index >= 0) {
		const line = buffer.text.slice(0, index);
		buffer.text = buffer.text.slice(index + 1);
		if (line.trim()) events.push(JSON.parse(line) as Event);
		index = buffer.text.indexOf("\n");
	}
	return events;
}

async function exchange(
	home: string,
	request: Record<string, unknown>,
	onEvent: (event: Event) => void,
	timeoutMs: number,
	onOpen?: () => void,
): Promise<void> {
	const paths = approverPaths(home);
	const token = (await readFile(paths.token, "utf8").catch(() => "")).trim();
	if (!token) throw new UsageError(NO_APPROVER);
	await new Promise<void>((resolve, reject) => {
		const buffer = { text: "" };
		let settled = false;
		let opened = false;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (error) reject(error);
			else resolve();
		};
		// Stale files from a closed terminal connect to nothing.
		const unreachable = () =>
			finish(
				new UsageError(
					`${NO_APPROVER} (approver.sock and approver.token in ${home} may be left over from a closed terminal)`,
				),
			);
		const timer = setTimeout(
			() => finish(new Error("approver did not answer in time")),
			timeoutMs,
		);
		Bun.connect({
			unix: paths.socket,
			socket: {
				open(socket) {
					opened = true;
					onOpen?.();
					socket.write(`${JSON.stringify({ token, ...request })}\n`);
				},
				data(socket, chunk) {
					let events: Event[];
					try {
						events = parseEvents(buffer, chunk.toString());
					} catch {
						finish(new Error("approver sent an invalid event"));
						socket.end();
						return;
					}
					for (const event of events) {
						onEvent(event);
						if (event.event === "done" || event.event === "pong") {
							// end() fires close() synchronously; settle first.
							finish();
							socket.end();
						}
					}
				},
				error(_socket, error) {
					if (opened) finish(error);
					else unreachable();
				},
				close() {
					if (opened) finish(new Error("approver closed the connection"));
					else unreachable();
				},
			},
		}).catch(() => unreachable());
	});
}

/** True when an approver answers on this home's socket. */
export async function approverStatus(
	home: string,
): Promise<{ running: boolean }> {
	try {
		let pong = false;
		await exchange(
			home,
			{ ping: true },
			(event) => {
				if (event.event === "pong") pong = true;
			},
			1_000,
		);
		return { running: pong };
	} catch {
		return { running: false };
	}
}

/** Hands a Proposal or ceremony id to the approver and relays its output. */
export async function relayToApprover(
	id: string,
	rt: Runtime,
): Promise<number> {
	if (!idPattern.test(id)) throw new UsageError("Invalid Proposal id");
	let code = 1;
	try {
		await exchange(
			rt.home,
			{ id },
			(event) => {
				if (event.event === "out") rt.out(event.text);
				else if (event.event === "err") rt.err(event.text);
				else if (event.event === "done") code = event.code;
			},
			ANSWER_TIMEOUT_MS,
			() =>
				rt.out(
					`Handed ${id} to your approver terminal; waiting for your answer there.`,
				),
		);
	} catch (error) {
		if (
			error instanceof Error &&
			error.message === "approver did not answer in time"
		)
			throw new UsageError(
				`No answer from the approver within ${ANSWER_TIMEOUT_MS / 60_000} minutes; the card was withdrawn. Check mob proposal show ${id}, then hand it over again.`,
			);
		throw error;
	}
	return code;
}

/** What the card commits to, read before the human decides. */
async function pin(id: string, rt: Runtime): Promise<string> {
	if (id.startsWith("c-"))
		return ceremonyFingerprint(
			await new CeremonyStore(rt.home, rt.now, rt.err).get(id),
		);
	return (await new ProposalStore(rt.home, rt.now, rt.err).get(id)).contentHash;
}

export interface ApproverOptions {
	/** Shows the card to the human and returns their decision; the signal fires when the requester leaves. */
	confirm: (card: string, withdrawn: AbortSignal) => Promise<boolean>;
	/** Reads the passphrase from the human; verified, then cached for the idle window. */
	read: SecretReader;
	idleMs?: number;
}

export async function startApprover(
	supplied: Partial<Runtime> & { home: string },
	options: ApproverOptions,
) {
	// Callers may pass a partial runtime (tests); fill the same defaults run() uses.
	const rt: Runtime = {
		fetch: globalThis.fetch,
		now: Date.now,
		out: console.log,
		err: console.error,
		...supplied,
	};
	const config = await readConfig(rt.home);
	if (!config.owner) throw new UsageError(SETUP_FIRST);
	if (config.signer !== "keystore")
		throw new UsageError("mob approver needs signer keystore (mob setup)");
	if ((config.policy ?? "manual") !== "manual")
		throw new UsageError("Wallet policy is locked");
	const owner = getAddress(config.owner);
	const paths = approverPaths(rt.home);
	if (Buffer.byteLength(paths.socket) > MAX_SOCKET_PATH)
		throw new UsageError(
			`The home path is too long for the approver socket (${paths.socket}); set MOB_HOME to a shorter path`,
		);
	if ((await approverStatus(rt.home)).running)
		throw new UsageError(
			"An approver is already running for this home; use it or stop it first",
		);
	const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
	const cache: { passphrase: string | null; at: number } = {
		passphrase: null,
		at: 0,
	};
	let forget: ReturnType<typeof setTimeout> | undefined;
	const remember = (passphrase: string) => {
		cache.passphrase = passphrase;
		cache.at = rt.now();
		if (forget) clearTimeout(forget);
		// Drop the passphrase when the window lapses, not only on the next request.
		forget = setTimeout(() => {
			cache.passphrase = null;
		}, idleMs);
		forget.unref?.();
	};
	const read: SecretReader = async (prompt, signal) => {
		const now = rt.now();
		if (cache.passphrase !== null && now - cache.at < idleMs) {
			remember(cache.passphrase);
			return cache.passphrase;
		}
		const passphrase = await options.read(prompt, signal);
		// Verify before caching, so a typo never poisons the idle window.
		const check = await unlockKeystore(rt.home, owner, async () => passphrase);
		await check.close?.();
		remember(passphrase);
		return passphrase;
	};
	// Verify the passphrase once before accepting requests.
	const probe = await unlockKeystore(rt.home, owner, read);
	await probe.close?.();
	const token = randomBytes(32).toString("hex");
	// Signing inside the approver cancels through this signal, never through
	// process signal listeners of its own (see p1.ts).
	const stopping = new AbortController();
	await rm(paths.socket, { force: true });
	await writeFile(paths.token, `${token}\n`, { mode: 0o600 });
	let busy: Promise<void> = Promise.resolve();
	const server = Bun.listen<Connection>({
		unix: paths.socket,
		socket: {
			open(socket) {
				socket.data = { text: "", done: false, closed: false };
			},
			close(socket) {
				// The requester left: a pending card is withdrawn.
				socket.data.closed = true;
				socket.data.withdraw?.abort();
			},
			data(socket, chunk) {
				const connection = socket.data;
				// One request per connection; later bytes are ignored.
				if (connection.done) return;
				connection.text += chunk.toString();
				const index = connection.text.indexOf("\n");
				if (index < 0) {
					if (connection.text.length > MAX_REQUEST_BYTES) {
						connection.done = true;
						socket.end();
					}
					return;
				}
				connection.done = true;
				const line = connection.text.slice(0, index);
				connection.text = "";
				const send = (event: Event) =>
					socket.write(`${JSON.stringify(event)}\n`);
				const fail = (text: string) => {
					send({ event: "err", text });
					send({ event: "done", code: 1 });
					socket.end();
				};
				let request: Request;
				try {
					request = JSON.parse(line) as Request;
				} catch {
					fail("invalid request");
					return;
				}
				if (request.token !== token) {
					fail("approver token mismatch");
					return;
				}
				if (request.ping === true) {
					send({ event: "pong" });
					socket.end();
					return;
				}
				const id = typeof request.id === "string" ? request.id : "";
				if (!idPattern.test(id)) {
					fail("invalid Proposal id");
					return;
				}
				const handle = async () => {
					if (connection.closed) return; // left the queue before its turn
					// The policy, signer, and owner the approver started with must still hold.
					const latest = await readConfig(rt.home);
					if ((latest.policy ?? "manual") !== "manual") {
						fail("Wallet policy is locked");
						return;
					}
					if (
						latest.signer !== "keystore" ||
						!latest.owner ||
						getAddress(latest.owner) !== owner
					) {
						fail("owner or signer changed; restart mob approver");
						return;
					}
					const card: string[] = [];
					const capture: Runtime = {
						...rt,
						out: (text) => card.push(text),
						err: (text) => card.push(text),
					};
					let pinned: string;
					try {
						pinned = await pin(id, rt);
						await p1("proposal", ["show", id], {}, capture);
					} catch (error) {
						fail(error instanceof Error ? error.message : String(error));
						return;
					}
					const text = card.join("\n");
					rt.out(`\nRequest to sign ${id}:\n${text}`);
					const withdraw = new AbortController();
					connection.withdraw = withdraw;
					const approved = await options.confirm(text, withdraw.signal);
					connection.withdraw = undefined;
					if (connection.closed) {
						rt.out(
							`Withdrawn ${id}: the requester disconnected before you answered; nothing was signed. Have it handed over again.`,
						);
						return;
					}
					if (!approved) {
						rt.out(`Declined ${id}; it stays as it is.`);
						fail(`${id} was declined in the approver`);
						return;
					}
					const relay: Runtime = {
						...rt,
						signal: stopping.signal,
						stdinIsTTY: true,
						stdoutIsTTY: false,
						out: (line) => {
							rt.out(line);
							send({ event: "out", text: line });
						},
						err: (line) => {
							rt.err(line);
							send({ event: "err", text: line });
						},
					};
					try {
						await p1(
							"sign",
							[id],
							{ with: "keystore", pin: pinned },
							relay,
							read,
						);
						send({ event: "done", code: 0 });
					} catch (error) {
						const message =
							error instanceof Error ? error.message : String(error);
						rt.err(`mob: ${message}`);
						send({ event: "err", text: `mob: ${message}` });
						send({ event: "done", code: 1 });
					}
					socket.end();
				};
				// One request at a time, and a failure never wedges the queue.
				busy = busy.then(handle).catch((error) => {
					const message =
						error instanceof Error ? error.message : String(error);
					rt.err(`mob: approver request for ${id} failed: ${message}`);
					fail(`approver request failed: ${message}`);
				});
			},
		},
	});
	rt.out(
		`Approver running for ${owner} · signer keystore · locks after ${Math.round(idleMs / 60_000)} min idle · Ctrl-C to stop`,
	);
	return {
		socketPath: paths.socket,
		async stop() {
			stopping.abort(new Error("Approver stopped"));
			server.stop(true);
			if (forget) clearTimeout(forget);
			cache.passphrase = null;
			// Remove only this run's files, never another approver's.
			const current = (
				await readFile(paths.token, "utf8").catch(() => "")
			).trim();
			if (current !== token) return;
			await rm(paths.socket, { force: true });
			await rm(paths.token, { force: true });
		},
	};
}

/**
 * Asks on the terminal the approver runs in. Ctrl-D declines; Ctrl-C declines
 * and stops the approver; a withdrawn request closes the prompt as a decline.
 */
async function confirmOnTerminal(
	question: string,
	withdrawn: AbortSignal,
): Promise<boolean> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const close = () => rl.close();
	try {
		const answer = await new Promise<string>((resolve) => {
			rl.once("close", () => resolve(""));
			rl.once("SIGINT", () => {
				resolve("");
				process.kill(process.pid, "SIGINT");
			});
			withdrawn.addEventListener("abort", close, { once: true });
			if (withdrawn.aborted) close();
			rl.question(question, resolve);
		});
		return /^y(es)?$/i.test(answer.trim());
	} finally {
		withdrawn.removeEventListener("abort", close);
		rl.close();
	}
}

/** The `mob approver` command: runs until interrupted. */
export async function approverCommand(
	values: Record<string, string | boolean | undefined>,
	rt: Runtime,
): Promise<void> {
	if (!rt.stdinIsTTY || !rt.stdoutIsTTY)
		throw new UsageError("mob approver needs your own terminal");
	const minutes = Number(values["idle-minutes"] ?? 30);
	if (!Number.isInteger(minutes) || minutes < 1 || minutes > 24 * 60)
		throw new UsageError(
			"--idle-minutes must be a whole number from 1 to 1440",
		);
	const handle = await startApprover(rt, {
		confirm: (_card, withdrawn) =>
			confirmOnTerminal("\nSign it? [y/N] ", withdrawn),
		// The passphrase comes from the human's controlling terminal.
		read: rt.readSecret ?? readSecretFromTty,
		idleMs: minutes * 60_000,
	});
	await new Promise<void>((resolve) => {
		const stop = () => {
			handle.stop().finally(() => {
				rt.out("Approver stopped.");
				resolve();
			});
		};
		// A closed terminal window (SIGHUP) cleans up like Ctrl-C.
		for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
			process.once(signal, stop);
	});
}
