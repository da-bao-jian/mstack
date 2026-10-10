// Ported from mobius@33ed2ece frontend/test/features/delta-neutral/sizeMismatchAutoCloseMessage.test.ts
import { describe, expect, it } from "bun:test";
import { buildSizeMismatchAutoCloseMessage } from "../src/sizeMismatchAutoCloseMessage.ts";

describe("frontend buildSizeMismatchAutoCloseMessage mirror", () => {
	it("matches the funding-server owner-signed message", () => {
		expect(
			buildSizeMismatchAutoCloseMessage({
				taskId: "t1",
				enabled: true,
				thresholdPct: 5,
				timestamp: 1787555739,
			}),
		).toBe(
			"Set size mismatch auto-close: t1 enabled=on thresholdPct=5 timestamp=1787555739",
		);
		expect(
			buildSizeMismatchAutoCloseMessage({
				taskId: "t1",
				enabled: false,
				thresholdPct: 0,
				timestamp: 1787555739,
			}),
		).toBe(
			"Set size mismatch auto-close: t1 enabled=off thresholdPct=0 timestamp=1787555739",
		);
	});
});
