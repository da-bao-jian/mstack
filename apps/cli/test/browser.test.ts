import { expect, test } from "bun:test";
import { browserFlow } from "./fixtures/browser-flow.ts";

test.each([false, true])(
	"CLI browser Proposal flow (override=%s)",
	async (override) => {
		const lines: string[] = [];
		await browserFlow((line) => lines.push(line), override);
		const index = lines.findIndex((line) =>
			line.startsWith("http://127.0.0.1:"),
		);
		expect(index).toBeGreaterThan(0);
		expect(lines[index + 1]).toStartWith("p-1: submitted · Server answer:");
		expect(lines[index + 1]).not.toContain("\n");
		expect(lines[index + 2]).toBe("exit=0");
		expect(lines.join("\n")).not.toContain("Waiting for your wallet");
		expect(lines.join("\n")).not.toContain("If no page opened");
	},
);

test.each(["browser", "walletconnect"] as const)(
	"%s TTY wait prints one URI and updates one line every two seconds; stop clears it",
	async (backend) => {
		const { walletWait } = await import("../src/wallet-wait.ts");
		const lines: string[] = [],
			updates: string[] = [];
		let now = 0;
		const wait = walletWait(
			{
				home: "unused",
				fetch: globalThis.fetch,
				now: () => now,
				out: (s) => lines.push(s),
				err: () => {},
				stdoutIsTTY: true,
				writeStatus: (s) => updates.push(s),
			},
			252_000,
		);
		const uri =
			backend === "browser"
				? "http://127.0.0.1:1234/sign/p-1?t=fixture"
				: "wc:fixture@2?relay-protocol=irn&symKey=fixture";
		try {
			wait.show(uri, backend);
			wait.show(uri, backend);
			expect(lines.filter((line) => line === uri)).toHaveLength(1);
			expect(lines).toContain(
				"If no page opened, paste the URL into your wallet browser",
			);
			expect(updates).toEqual([
				"\r\x1b[2KWaiting for your wallet · expires in 4:12",
			]);
			now = 2_000;
			await Bun.sleep(2_100);
			expect(updates).toHaveLength(2);
			expect(updates[1]).toBe(
				"\r\x1b[2KWaiting for your wallet · expires in 4:10",
			);
			wait.stop();
			wait.stop();
			expect(updates.at(-1)).toBe("\r\x1b[2K");
			const count = updates.length;
			await Bun.sleep(2_100);
			expect(updates).toHaveLength(count);
		} finally {
			wait.stop();
		}
	},
	10_000,
);
