import { expect, test } from "bun:test";
import type { Level } from "@mstack/funding";
import { executionCost } from "../src/index.ts";

const book: { bids: Level[]; asks: Level[] } = {
	bids: [
		[99, 10],
		[98, 100],
	],
	asks: [
		[101, 10],
		[102, 100],
	],
};

test("a fill inside the best level pays half the spread plus the fee", () => {
	const fill = executionCost(book, 505, "long", 4.5);
	expect(fill.mid).toBe(100);
	expect(fill.complete).toBe(true);
	expect(fill.averagePrice).toBeCloseTo(101, 10);
	expect(fill.slippageBps).toBeCloseTo(100, 10);
	expect(fill.costBps).toBeCloseTo(104.5, 10);
	expect(fill.costUsd).toBeCloseTo(505 * 0.01045, 10);
});

test("a larger fill walks the levels and averages the prices it takes", () => {
	// 10 at 101 is $1,010; the rest, $1,030, takes 1,030/102 at 102.
	const fill = executionCost(book, 2_040, "long", 0);
	const base = 10 + 1_030 / 102;
	expect(fill.averagePrice).toBeCloseTo(2_040 / base, 10);
	expect(fill.costBps).toBeCloseTo(((2_040 / base - 100) / 100) * 10_000, 10);
	const short = executionCost(book, 1_970, "short", 0);
	expect(short.averagePrice).toBeCloseTo(1_970 / (10 + 980 / 98), 10);
	expect(short.slippageBps).toBeGreaterThan(0);
});

test("a size past the book reports what it can fill and no cost", () => {
	const fill = executionCost(book, 1_000_000, "long", 4.5);
	expect(fill.complete).toBe(false);
	expect(fill.filledUsd).toBeCloseTo(10 * 101 + 100 * 102, 6);
	expect(fill.costBps).toBeUndefined();
	expect(fill.costUsd).toBeUndefined();
	expect(fill.averagePrice).toBeDefined();
});

test("bad inputs are refused", () => {
	expect(() => executionCost(book, 0, "long", 1)).toThrow("sizeUsd");
	expect(() => executionCost(book, 10, "long", -1)).toThrow("takerFeeBps");
	expect(() =>
		executionCost({ bids: [], asks: book.asks }, 10, "long", 1),
	).toThrow("both sides");
});
