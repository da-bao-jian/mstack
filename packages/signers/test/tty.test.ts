import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { secretLine } from "../src/tty.ts";

/** Feeds typed text and backspaces (as DEL bytes) through the line editor. */
function typed(...keys: (string | "⌫")[]) {
	const line = secretLine();
	for (const key of keys)
		for (const byte of key === "⌫" ? [127] : Buffer.from(key, "utf8"))
			expect(line.push(byte)).toBe("more");
	expect(line.push(13)).toBe("done");
	return line.value();
}

test("backspace removes one whole UTF-8 code point, never a lone byte", () => {
	expect(typed("pässwörd", "⌫")).toBe("pässwör");
	expect(typed("pässwö", "⌫", "o")).toBe("pässwo");
	expect(typed("key🔑", "⌫")).toBe("key");
	expect(typed("€", "⌫", "⌫", "a")).toBe("a");
	expect(typed("añ", "\b")).toBe("a");
	const line = secretLine();
	for (const byte of Buffer.from("日本", "utf8")) line.push(byte);
	line.push(8);
	expect(line.value()).toBe("日");
	expect(line.value()).not.toContain("\uFFFD");
});

test("the secret is NFC-normalized, and control bytes cancel, finish, or fail", () => {
	expect(typed("cafe\u0301")).toBe("caf\u00e9");
	expect(typed("caf\u00e9")).toBe("caf\u00e9");
	const line = secretLine(3);
	expect(line.push(3)).toBe("cancel");
	expect(line.push(4)).toBe("cancel");
	expect(line.push(10)).toBe("done");
	expect(line.push(27)).toBe("invalid");
	for (const byte of [97, 98, 99]) expect(line.push(byte)).toBe("more");
	expect(line.push(100)).toBe("invalid");
	line.clear();
});

test("production reader refuses a detached process even when stdin contains a passphrase", async () => {
	const reader = fileURLToPath(new URL("../src/tty.ts", import.meta.url));
	const source = `import { readSecretFromTty } from ${JSON.stringify(reader)}; try { await readSecretFromTty("Secret: "); process.exitCode=2; } catch(error) { console.error(error.message); process.exitCode=1; }`;
	const child = spawn(process.execPath, ["--eval", source], {
		detached: true,
		stdio: ["pipe", "pipe", "pipe"],
	});
	let out = "",
		err = "";
	child.stdout.on("data", (chunk) => {
		out += chunk;
	});
	child.stderr.on("data", (chunk) => {
		err += chunk;
	});
	child.stdin.end("must-not-be-read\n");
	const code = await new Promise<number | null>((resolve, reject) => {
		child.on("exit", resolve);
		child.on("error", reject);
	});
	expect(code).toBe(1);
	expect(err).toContain("controlling TTY");
	expect(out + err).not.toContain("must-not-be-read");
});
