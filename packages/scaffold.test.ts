import { expect, test } from "bun:test";

test("README states the session-key custody boundary", async () => {
	const readme = await Bun.file(
		new URL("../README.md", import.meta.url),
	).text();
	for (const statement of [
		"Your wallet key never leaves your wallet.",
		"The Mobius API key is a scoped trading key.",
		"It cannot withdraw, bind venues, approve fees, accept legal terms, or create keys.",
		"A key pasted for onboarding remains in the chat transcript and local agent session logs.",
		"Your funds stay in your own venue accounts.",
		"Everything the agent reads is public",
	])
		expect(readme).toContain(statement);
});
