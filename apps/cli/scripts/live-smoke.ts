import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.MOB_LIVE !== "1")
	throw new Error("Live CLI requests require MOB_LIVE=1");
const home = await mkdtemp(join(tmpdir(), "mob-live-"));
const binary = fileURLToPath(new URL("../dist/mob", import.meta.url));
const commands = [
	["scan", "--json"],
	["scan", "--size", "5000", "--top", "5"],
	["rates", "--venue", "hl", "--market", "BTC"],
	["history", "BTC", "--days", "3"],
	["explain", "funding"],
	["status", "--owner", "0x0000000000000000000000000000000000000001"],
];
try {
	for (const args of commands) {
		console.log(`$ mob ${args.join(" ")}`);
		const start = performance.now();
		const child = Bun.spawn([binary, ...args], {
			cwd: home,
			env: { ...process.env, MOB_HOME: home },
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		if (args.includes("--json")) {
			const data = JSON.parse(stdout);
			console.log(
				JSON.stringify(
					{
						opportunities: data.opportunities.length,
						qualifying: data.opportunities.filter(
							(r: { qualifies: boolean }) => r.qualifies,
						).length,
						view: {
							executable: data.view.executable.length,
							anywhere: data.view.anywhere.length,
						},
						unmatched: data.unmatched.length,
						failed: data.failed,
						observedAt: data.observedAt,
						source: data.source,
						annualizationMethod: data.annualizationMethod,
					},
					null,
					2,
				),
			);
			if (data.failed.length) throw new Error("scan returned venue failures");
		} else console.log(stdout.trimEnd());
		if (stderr) console.log(stderr.trimEnd());
		console.log(
			`exit=${exitCode} wall=${((performance.now() - start) / 1000).toFixed(2)}s\n`,
		);
		if (exitCode !== 0)
			throw new Error(`Smoke command failed: ${args.join(" ")}`);
		if (
			["scan", "rates", "history"].includes(args[0]) &&
			!`${stdout}\n${stderr}`.includes("failed: none")
		)
			throw new Error("Smoke command reported failures");
	}
} finally {
	await rm(home, { recursive: true, force: true });
}
