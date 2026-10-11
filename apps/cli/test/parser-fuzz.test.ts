import { expect, test } from "bun:test";
import { seeded } from "../../../packages/test-seed.ts";
import { UsageError } from "../src/config.ts";
import { parseCommand } from "../src/help.ts";
import { definitions } from "../src/run.ts";

test("seed 0x1701: random argument sequences return values or named usage errors", () => {
	const random = seeded(0x1701);
	let failures = 0;
	for (const [command, options] of Object.entries(definitions)) {
		const tokens = [
			"BTC",
			"p-1",
			"",
			"--",
			"-",
			"--unknown",
			"--0",
			"--☃",
			"-9",
			"--__proto__",
			"--help=no",
			"1e309",
			...Object.keys(options ?? {}).flatMap((key) => [
				`--${key}`,
				`--${key}=1`,
				`--${key}=`,
				`--${key}=--bad`,
			]),
		];
		for (let iteration = 0; iteration < 100; iteration++) {
			const args = Array.from(
				{ length: 1 + random(10) },
				() => tokens[random(tokens.length)],
			);
			try {
				parseCommand(command, args, options);
			} catch (error) {
				failures++;
				expect(error).toBeInstanceOf(UsageError);
				const message = (error as Error).message;
				expect(message).toContain(`mob ${command} --help`);
				expect(message).not.toMatch(/ERR_|TypeError|node:internal/);
				expect(
					args
						.filter((arg) => arg.startsWith("-") && arg !== "--")
						.some((arg) => message.includes(arg.split("=")[0])),
				).toBe(true);
			}
		}
	}
	expect(failures).toBeGreaterThan(1000);
});
