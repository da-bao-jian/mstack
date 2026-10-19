import { closeSync, openSync, writeSync } from "node:fs";
import { ReadStream } from "node:tty";

/** Production reads only the controlling terminal. Tests inject this interface. */
export type SecretReader = (
	prompt: string,
	signal?: AbortSignal,
) => Promise<string>;
type LineEvent = "more" | "done" | "cancel" | "invalid";

/** Line editing for a hidden secret, one input byte at a time. Backspace
 * removes a whole UTF-8 code point, and the value is NFC-normalized, so the
 * same visible passphrase always yields the same string. */
export function secretLine(limit = 4096) {
	const bytes: number[] = [];
	return {
		push(byte: number): LineEvent {
			if (byte === 3 || byte === 4) return "cancel";
			if (byte === 10 || byte === 13) return "done";
			if (byte === 127 || byte === 8) {
				// Continuation bytes are 10xxxxxx; drop them, then the lead byte.
				while (bytes.length && ((bytes.at(-1) as number) & 0xc0) === 0x80)
					bytes.pop();
				bytes.pop();
				return "more";
			}
			if (byte >= 32 && bytes.length < limit) {
				bytes.push(byte);
				return "more";
			}
			return "invalid";
		},
		value: () => Buffer.from(bytes).toString("utf8").normalize("NFC"),
		clear: () => bytes.fill(0),
	};
}

export const readSecretFromTty: SecretReader = async (prompt, signal) => {
	signal?.throwIfAborted();
	let fd: number;
	try {
		fd = openSync("/dev/tty", "r+");
	} catch {
		throw new Error("A controlling TTY (/dev/tty) is required");
	}
	let tty: ReadStream;
	try {
		tty = new ReadStream(fd);
	} catch {
		closeSync(fd);
		throw new Error("A controlling TTY (/dev/tty) is required");
	}
	const wasRaw = tty.isRaw;
	const line = secretLine();
	let cancel: (() => void) | undefined;
	try {
		if (!tty.isTTY) throw new Error("A controlling TTY (/dev/tty) is required");
		tty.setRawMode(true);
		writeSync(fd, prompt);
		return await new Promise<string>((resolve, reject) => {
			let finished = false;
			const finish = (error?: Error) => {
				if (finished) return;
				finished = true;
				tty.pause();
				writeSync(fd, "\n");
				if (error) reject(error);
				else resolve(line.value());
			};
			cancel = () => finish(new Error("TTY input cancelled"));
			signal?.addEventListener("abort", cancel, { once: true });
			if (signal?.aborted) cancel();
			tty.on("data", (chunk: Buffer) => {
				for (const byte of chunk) {
					if (finished) break;
					const event = line.push(byte);
					if (event === "cancel") {
						finish(new Error("TTY input cancelled"));
						break;
					}
					if (event === "done") {
						finish();
						break;
					}
					if (event === "invalid") {
						finish(new Error("Invalid or excessive TTY input"));
						break;
					}
				}
				chunk.fill(0);
			});
			tty.on("error", finish);
			tty.on("end", () => finish(new Error("TTY closed before input")));
		});
	} finally {
		if (cancel) signal?.removeEventListener("abort", cancel);
		line.clear();
		if (tty.isTTY) tty.setRawMode(wasRaw);
		tty.destroy();
	}
};
