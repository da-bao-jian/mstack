import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

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
