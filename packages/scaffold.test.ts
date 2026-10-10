import { expect, test } from "bun:test";

test("README preserves the PRD custody statement verbatim", async () => {
	const prd = await Bun.file(new URL("../docs/PRD.md", import.meta.url)).text();
	const readme = await Bun.file(
		new URL("../README.md", import.meta.url),
	).text();
	const statement = prd
		.split("### 6.8 Custody statement (goes in the README, verbatim)\n\n")[1]
		?.split("\n\n### 6.9")[0];
	expect(statement).toBeDefined();
	expect(readme).toContain(statement as string);
});
