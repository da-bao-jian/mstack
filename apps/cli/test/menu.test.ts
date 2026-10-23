import { expect, test } from "bun:test";
import {
	buildMenu,
	CHAT_LINE,
	menuHeader,
	menuLine,
	menuPhrase,
} from "../src/menu.ts";

const owner = "0x0000000000000000000000000000000000000001";
const says = (input: Parameters<typeof buildMenu>[0]) =>
	buildMenu(input).rows.map((row) => row.say);

test("a fresh install offers research first and setup only to trade", () => {
	const menu = buildMenu({ owner: null, hasKey: false, awaiting: [] });
	expect(menu.state).toBe("fresh");
	// One row per section, setup last.
	expect(menu.rows.map((row) => [row.say, row.run])).toEqual([
		["best funding now", "mob scan --size 1000"],
		["all markets", "mob markets"],
		["history BTC", "mob history BTC --days 7"],
		["set up mstack", "mob onboard"],
	]);
	expect(menu.rows[3].note).toBe("to trade");
});

test("an owner without a key is finishing setup; research stays available", () => {
	const menu = buildMenu({ owner, hasKey: false, awaiting: [] });
	expect(menu.state).toBe("setting-up");
	expect(menu.rows[0]).toMatchObject({
		say: "set up mstack",
		note: "to finish setup",
		run: "mob onboard",
	});
	expect(says({ owner, hasKey: false, awaiting: [] })).toEqual([
		"set up mstack",
		"best funding now",
		"all markets",
		"history BTC",
	]);
});

test("the full menu is four sections of at most four rows, research before the account", () => {
	for (const input of [
		{ owner: null, hasKey: false, awaiting: [] },
		{ owner, hasKey: false, awaiting: [] },
		{ owner, hasKey: true, awaiting: [], runningTasks: 1 },
		{ owner, hasKey: true, awaiting: ["c-2"] },
	]) {
		const { sections, rows } = buildMenu(input);
		expect(sections.map((section) => section.name)).toEqual([
			"Find trades",
			"Explore markets",
			"Charts & costs",
			"Trade & account",
		]);
		for (const section of sections) {
			expect(section.rows.length).toBeGreaterThanOrEqual(2);
			expect(section.rows.length).toBeLessThanOrEqual(4);
			expect(section.note.length).toBeGreaterThan(0);
			// The picker describes what each row gives, never the command.
			for (const row of section.rows) {
				expect(row.about?.length).toBeGreaterThan(0);
				expect(row.about).not.toContain("mob ");
			}
		}
		// Every short-list row is in the full menu, or is a pick row with BTC.
		const all = sections.flatMap((section) => section.rows);
		const examples = all.flatMap((row) =>
			row.pick
				? [
						{
							say: row.pick.replace("<asset>", "BTC"),
							run: row.run.replaceAll("<asset>", "BTC"),
						},
					]
				: [],
		);
		for (const row of rows) expect([...all, ...examples]).toContainEqual(row);
	}
	const fresh = buildMenu({ owner: null, hasKey: false, awaiting: [] });
	expect(fresh.assets.map((asset) => asset.ticker)).toEqual([
		"BTC",
		"ETH",
		"SOL",
		"HYPE",
	]);
	expect(fresh.sections[0].rows.map((row) => row.run)).toEqual([
		"mob scan --size 1000",
		"mob scan --by price",
		"mob scan --rwa",
		"mob watch",
	]);
	expect(fresh.sections[1].rows.map((row) => row.say)).toEqual([
		"all markets",
		"one asset on every venue",
		"venues by volume",
		"RWA markets",
	]);
	expect(fresh.sections[1].rows[1]).toMatchObject({
		run: "mob market <asset>",
		pick: "<asset> on every venue",
	});
	expect(fresh.sections[2].rows.map((row) => [row.say, row.pick])).toEqual([
		["cost to trade", "cost to trade <asset>"],
		["price spread chart", "chart <asset> on Hyperliquid vs Lighter"],
		["funding history", "history <asset>"],
		["WTI vs Brent", undefined],
	]);
	expect(fresh.sections[2].rows.map((row) => row.run)).toEqual([
		"mob cost <asset>",
		"mob spread hl:<asset> lighter-mainnet:<asset>",
		"mob history <asset> --days 7",
		"mob oil",
	]);
	expect(fresh.sections[3].rows.map((row) => row.say)).toEqual([
		"set up mstack",
		"how does funding work",
		"how do MoB keys work",
	]);
	expect(fresh.sections[3].rows[0]).toMatchObject({
		say: "set up mstack",
		note: "to trade",
		run: "mob onboard",
	});
	const awaiting = buildMenu({ owner, hasKey: true, awaiting: ["c-2"] })
		.sections[3];
	expect(awaiting.note).toBe("c-2 waits for your signature");
	expect(awaiting.rows[0].run).toBe("mob sign c-2");
});

test("a stored key offers trading rows, with close only while a task runs", () => {
	const base = { owner, hasKey: true, awaiting: [] };
	expect(buildMenu(base).state).toBe("trading");
	expect(says(base)).toEqual([
		"open a position",
		"my positions",
		"best funding now",
		"raise my cap",
	]);
	// The command column does what the phrase says, flags and all.
	expect(buildMenu(base).rows[0].run).toBe(
		"mob open <asset> --long <venue:market> --short <venue:market> --size <usd>",
	);
	// Four rows at most: a running task puts close in place of the cap row.
	expect(says({ ...base, runningTasks: 2 })).toEqual([
		"open a position",
		"my positions",
		"best funding now",
		"close a position",
	]);
});

test("labels never carry market data: the same state gives the same menu", () => {
	// A label is what the row does; the asset comes from the user after `pick`.
	const labels = (menu: ReturnType<typeof buildMenu>) =>
		menu.sections.flatMap((section) => section.rows.map((row) => row.say));
	for (const input of [
		{ owner: null, hasKey: false, awaiting: [] },
		{ owner, hasKey: true, awaiting: [] },
	]) {
		const menu = buildMenu(input);
		for (const say of labels(menu)) {
			expect(say).not.toContain("<");
			for (const { ticker } of menu.assets)
				expect(say.split(" ")).not.toContain(ticker);
		}
		for (const row of menu.sections.flatMap((section) => section.rows))
			if (row.pick) {
				expect(row.pick).toContain("<asset>");
				expect(row.about).toContain("you pick the asset");
			}
	}
});

test("a Proposal awaiting signature comes first, then at most three state rows", () => {
	const menu = buildMenu({ owner, hasKey: true, awaiting: ["p-3", "p-4"] });
	expect(menu.state).toBe("awaiting");
	expect(menu.rows[0]).toMatchObject({
		say: "sign p-3",
		note: "first",
		run: "mob sign p-3",
	});
	expect(menu.rows).toHaveLength(4);
	expect(menu.rows[1].say).toBe("open a position");
});

test("menu lines pad the phrase so commands align; headers and the chat line name every host", () => {
	expect(
		menuPhrase({ say: "sign p-1", note: "first", run: "mob sign p-1" }),
	).toBe('"sign p-1"  first');
	expect(menuLine({ say: "my positions", run: "mob status" }, 24)).toBe(
		`"my positions"${" ".repeat(12)}mob status`,
	);
	expect(
		menuLine({ say: "sign p-1", note: "first", run: "mob sign p-1" }),
	).toBe(`"sign p-1"  first${" ".repeat(15)}mob sign p-1`);
	expect(menuHeader("chat")).toEqual(["say in chat", "or run in a terminal"]);
	expect(menuHeader("hosts")[0]).toBe("say in Claude Code or Codex");
	expect(CHAT_LINE).toContain("/mstack:mob");
	expect(CHAT_LINE).toContain("$mob");
});
