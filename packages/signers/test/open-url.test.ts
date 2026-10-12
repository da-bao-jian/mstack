import { expect, test } from "bun:test";
import { openSuppressed, openUrl } from "../src/open-url.ts";

test("MOB_NO_OPEN suppresses the browser opener unless it is 0 or empty", () => {
	expect(openSuppressed({ MOB_NO_OPEN: "1" })).toBe(true);
	expect(openSuppressed({ MOB_NO_OPEN: "true" })).toBe(true);
	expect(openSuppressed({ MOB_NO_OPEN: "0" })).toBe(false);
	expect(openSuppressed({ MOB_NO_OPEN: "" })).toBe(false);
	expect(openSuppressed({})).toBe(false);
});

test("a test runner never opens a browser, whatever the flags say", () => {
	expect(openSuppressed({ NODE_ENV: "test" })).toBe(true);
	expect(openSuppressed({ NODE_ENV: "test", MOB_NO_OPEN: "0" })).toBe(true);
	// bun test sets NODE_ENV=test for this very process.
	expect(openSuppressed()).toBe(true);
});

test("BROWSER is honored without shell interpolation", async () => {
	await expect(
		openUrl("https://example.test/?nav=api", {
			NODE_ENV: "production",
			BROWSER: "true",
		}),
	).resolves.toBeUndefined();
	await expect(
		openUrl("https://example.test", {
			NODE_ENV: "production",
			BROWSER: "bad\ncommand",
		}),
	).rejects.toThrow("control characters");
});
