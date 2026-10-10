import { test } from "bun:test";
import { browserFlow } from "./fixtures/browser-flow.ts";

test.each([false, true])(
	"CLI browser Proposal flow (override=%s)",
	async (override) => {
		await browserFlow(() => {}, override);
	},
);
