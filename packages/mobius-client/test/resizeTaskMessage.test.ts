// Ported from mobius@33ed2ece frontend/test/features/delta-neutral/resizeTaskMessage.test.ts
import { describe, expect, it } from "bun:test";
import { buildResizeTaskMessage } from "../src/resizeTaskMessage.ts";

/**
 * These literals must stay byte-identical to the ones in
 * `funding-server/src/server/routes/arbitrage.test.ts`. They are written out in
 * full rather than composed, so a change to either builder fails here loudly
 * instead of producing a different-but-self-consistent string on one side —
 * which the server would answer with "invalid signature" and no other clue.
 */
const TS = 1787555739;

describe("frontend buildResizeTaskMessage mirror", () => {
	it("names both targets on a linked resize, in order", () => {
		expect(
			buildResizeTaskMessage({
				taskId: "t1",
				timestamp: TS,
				longTargetBase: 12.34,
				shortTargetBase: 12.34,
			}),
		).toBe(
			"Resize arbitrage task: t1 timestamp=1787555739 longTarget=12.34 shortTarget=12.34",
		);
	});

	it("appends only the leg a single-leg resize moves", () => {
		// Absent, not zero and not a placeholder: a leg that is not moving has no
		// target, and inventing one would make "leave it alone" indistinguishable
		// from "set it to this".
		expect(
			buildResizeTaskMessage({
				taskId: "t1",
				timestamp: TS,
				longTargetBase: 12.34,
			}),
		).toBe("Resize arbitrage task: t1 timestamp=1787555739 longTarget=12.34");
		expect(
			buildResizeTaskMessage({
				taskId: "t1",
				timestamp: TS,
				shortTargetBase: 9,
			}),
		).toBe("Resize arbitrage task: t1 timestamp=1787555739 shortTarget=9");
	});

	it("treats an explicit undefined the same as an omitted field", () => {
		expect(
			buildResizeTaskMessage({
				taskId: "t1",
				timestamp: TS,
				longTargetBase: 12,
				shortTargetBase: undefined,
			}),
		).toBe(
			buildResizeTaskMessage({
				taskId: "t1",
				timestamp: TS,
				longTargetBase: 12,
			}),
		);
	});

	it("appends size-mismatch disable only when explicitly requested", () => {
		expect(
			buildResizeTaskMessage({
				taskId: "t1",
				timestamp: TS,
				longTargetBase: 12,
				shortTargetBase: 12,
				disableSizeMismatchAutoClose: true,
			}),
		).toBe(
			"Resize arbitrage task: t1 timestamp=1787555739 longTarget=12 shortTarget=12 disableSizeMismatchAutoClose=on",
		);
		expect(
			buildResizeTaskMessage({
				taskId: "t1",
				timestamp: TS,
				longTargetBase: 12,
				disableSizeMismatchAutoClose: false,
			}),
		).toBe("Resize arbitrage task: t1 timestamp=1787555739 longTarget=12");
	});

	it("produces three distinct strings for the three shapes", () => {
		// Otherwise a signature captured for one leg could be replayed for both.
		const both = buildResizeTaskMessage({
			taskId: "t1",
			timestamp: TS,
			longTargetBase: 12,
			shortTargetBase: 12,
		});
		const longOnly = buildResizeTaskMessage({
			taskId: "t1",
			timestamp: TS,
			longTargetBase: 12,
		});
		const shortOnly = buildResizeTaskMessage({
			taskId: "t1",
			timestamp: TS,
			shortTargetBase: 12,
		});
		expect(new Set([both, longOnly, shortOnly]).size).toBe(3);
	});

	it("differs from every other owner-signed action's message", () => {
		const resize = buildResizeTaskMessage({
			taskId: "t1",
			timestamp: TS,
			longTargetBase: 12,
		});
		expect(resize).not.toBe(`Close arbitrage task: t1 timestamp=${TS}`);
		expect(resize).not.toBe(`Neutralize arbitrage task: t1 timestamp=${TS}`);
	});
});
