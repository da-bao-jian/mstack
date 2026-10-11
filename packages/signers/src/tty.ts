import { closeSync, openSync, writeSync } from "node:fs";
import { ReadStream } from "node:tty";

/** Production reads only the controlling terminal. Tests inject this interface. */
export type SecretReader = (
	prompt: string,
	signal?: AbortSignal,
) => Promise<string>;
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
	const bytes: number[] = [];
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
				else resolve(Buffer.from(bytes).toString("utf8"));
			};
			cancel = () => finish(new Error("TTY input cancelled"));
			signal?.addEventListener("abort", cancel, { once: true });
			if (signal?.aborted) cancel();
			tty.on("data", (chunk: Buffer) => {
				for (const byte of chunk) {
					if (finished) break;
					if (byte === 3 || byte === 4) {
						finish(new Error("TTY input cancelled"));
						break;
					}
					if (byte === 10 || byte === 13) {
						finish();
						break;
					}
					if (byte === 127 || byte === 8) bytes.pop();
					else if (byte >= 32 && bytes.length < 4096) bytes.push(byte);
					else {
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
		bytes.fill(0);
		if (tty.isTTY) tty.setRawMode(wasRaw);
		tty.destroy();
	}
};
