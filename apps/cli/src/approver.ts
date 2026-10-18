import { randomBytes } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { type SecretReader, unlockKeystore } from "@mstack/signers";
import { getAddress } from "viem";
import { readConfig, SETUP_FIRST, UsageError } from "./config.ts";
import { p1 } from "./p1.ts";
import type { Runtime } from "./run.ts";

/**
 * A persistent local approver for keystore users. It runs in the human's own
 * terminal, unlocks the keystore once per idle window, and signs a Proposal
 * or ceremony only after the human answers "y" to its card. The agent's
 * `mob sign <id>` hands the id over a local socket and relays the output; the
 * passphrase and the key never leave this process.
 */

const SOCKET = "approver.sock";
const TOKEN = "approver.token";
const DEFAULT_IDLE_MS = 30 * 60 * 1000;

type Request = { token?: unknown; id?: unknown; ping?: unknown };
type Event =
	| { event: "out" | "err"; text: string }
	| { event: "done"; code: number }
	| { event: "pong" };

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
): Promise<void> {
	const paths = approverPaths(home);
	const token = (await readFile(paths.token, "utf8").catch(() => "")).trim();
	if (!token)
		throw new UsageError(
			"no approver is running; start mob approver in your own terminal",
		);
	await new Promise<void>((resolve, reject) => {
		const buffer = { text: "" };
		let settled = false;
		const finish = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (error) reject(error);
			else resolve();
		};
		const timer = setTimeout(
			() => finish(new Error("approver did not answer in time")),
			timeoutMs,
		);
		Bun.connect({
			unix: paths.socket,
			socket: {
				open(socket) {
					socket.write(`${JSON.stringify({ token, ...request })}\n`);
				},
				data(socket, chunk) {
					for (const event of parseEvents(buffer, chunk.toString())) {
						onEvent(event);
						if (event.event === "done" || event.event === "pong") {
							// end() fires close() synchronously; settle first.
							finish();
							socket.end();
						}
					}
				},
				error(_socket, error) {
					finish(error);
				},
				close() {
					finish(new Error("approver closed the connection"));
				},
			},
		}).catch((error: Error) => finish(error));
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
	rt.out(
		`Handed ${id} to your approver terminal; waiting for your answer there.`,
	);
	await exchange(
		rt.home,
		{ id },
		(event) => {
			if (event.event === "out") rt.out(event.text);
			else if (event.event === "err") rt.err(event.text);
			else if (event.event === "done") code = event.code;
		},
		60 * 60 * 1000,
	);
	return code;
}

export interface ApproverOptions {
	/** Shows the card to the human and returns their decision. */
	confirm: (card: string) => Promise<boolean>;
	/** Reads the passphrase from the human; cached for the idle window. */
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
	const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
	const cache: { passphrase: string | null; at: number } = {
		passphrase: null,
		at: 0,
	};
	const read: SecretReader = async (prompt, signal) => {
		const now = rt.now();
		if (cache.passphrase !== null && now - cache.at < idleMs) {
			cache.at = now;
			return cache.passphrase;
		}
		const passphrase = await options.read(prompt, signal);
		cache.passphrase = passphrase;
		cache.at = rt.now();
		return passphrase;
	};
	// Verify the passphrase once before accepting requests.
	const probe = await unlockKeystore(rt.home, owner, read);
	await probe.close?.();
	const paths = approverPaths(rt.home);
	const token = randomBytes(32).toString("hex");
	await rm(paths.socket, { force: true });
	await writeFile(paths.token, `${token}\n`, { mode: 0o600 });
	let busy: Promise<void> = Promise.resolve();
	const server = Bun.listen({
		unix: paths.socket,
		socket: {
			open(socket) {
				(socket as { data?: unknown }).data = { text: "" };
			},
			data(socket, chunk) {
				const buffer = (socket as { data?: { text: string } }).data ?? {
					text: "",
				};
				(socket as { data?: unknown }).data = buffer;
				buffer.text += chunk.toString();
				const index = buffer.text.indexOf("\n");
				if (index < 0) return;
				const line = buffer.text.slice(0, index);
				buffer.text = "";
				const send = (event: Event) =>
					socket.write(`${JSON.stringify(event)}\n`);
				let request: Request;
				try {
					request = JSON.parse(line) as Request;
				} catch {
					send({ event: "err", text: "invalid request" });
					send({ event: "done", code: 1 });
					socket.end();
					return;
				}
				if (request.token !== token) {
					send({ event: "err", text: "approver token mismatch" });
					send({ event: "done", code: 1 });
					socket.end();
					return;
				}
				if (request.ping === true) {
					send({ event: "pong" });
					socket.end();
					return;
				}
				const id = typeof request.id === "string" ? request.id : "";
				if (!idPattern.test(id)) {
					send({ event: "err", text: "invalid Proposal id" });
					send({ event: "done", code: 1 });
					socket.end();
					return;
				}
				busy = busy.then(async () => {
					const card: string[] = [];
					const capture: Runtime = {
						...rt,
						out: (text) => card.push(text),
						err: (text) => card.push(text),
					};
					try {
						await p1("proposal", ["show", id], {}, capture);
					} catch (error) {
						send({
							event: "err",
							text: error instanceof Error ? error.message : String(error),
						});
						send({ event: "done", code: 1 });
						socket.end();
						return;
					}
					const text = card.join("\n");
					rt.out(`\nRequest to sign ${id}:\n${text}`);
					const approved = await options.confirm(text);
					if (!approved) {
						rt.out(`Declined ${id}; it stays as it is.`);
						send({ event: "err", text: `${id} was declined in the approver` });
						send({ event: "done", code: 1 });
						socket.end();
						return;
					}
					const relay: Runtime = {
						...rt,
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
						await p1("sign", [id], { with: "keystore" }, relay, read);
						send({ event: "done", code: 0 });
					} catch (error) {
						const message =
							error instanceof Error ? error.message : String(error);
						rt.err(`mob: ${message}`);
						send({ event: "err", text: `mob: ${message}` });
						send({ event: "done", code: 1 });
					}
					socket.end();
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
			server.stop(true);
			cache.passphrase = null;
			await rm(paths.socket, { force: true });
			await rm(paths.token, { force: true });
		},
	};
}

/** Asks on the terminal the approver runs in. */
async function confirmOnTerminal(question: string): Promise<boolean> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const answer = await new Promise<string>((resolve) =>
			rl.question(question, resolve),
		);
		return /^y(es)?$/i.test(answer.trim());
	} finally {
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
	if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60)
		throw new UsageError("--idle-minutes must be between 1 and 1440");
	const read = rt.readSecret;
	if (!read)
		throw new UsageError(
			"mob approver needs a terminal to read the passphrase",
		);
	const handle = await startApprover(rt, {
		confirm: () => confirmOnTerminal("\nSign it? [y/N] "),
		read,
		idleMs: minutes * 60_000,
	});
	await new Promise<void>((resolve) => {
		const stop = () => {
			handle.stop().finally(() => {
				rt.out("Approver stopped.");
				resolve();
			});
		};
		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);
	});
}
