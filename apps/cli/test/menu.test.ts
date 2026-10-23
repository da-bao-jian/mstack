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
	// The top pair names the history example so the row matches the board.
	expect(
		says({
			owner: null,
			hasKey: false,
			awaiting: [],
			topPair: { base: "ETH" },
		}),
	).toContain("history ETH");
});

test("an owner without a key is finishing setup; research stays available", () => {
	const menu = buildMenu({ owner, hasKey: false, awaiting: [] });
	expect(menu.state).toBe("setting-up");
	expect(menu.rows[0]).toEqual({
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
		}
		// Every short-list row is also in the full menu.
		const all = sections.flatMap((section) => section.rows);
		for (const row of rows) expect(all).toContainEqual(row);
	}
	const fresh = buildMenu({
		owner: null,
		hasKey: false,
		awaiting: [],
		topPair: { base: "ETH" },
	}).sections;
	expect(fresh[0].rows.map((row) => row.run)).toEqual([
		"mob scan --size 1000",
		"mob scan --by price",
		"mob scan --rwa",
		"mob watch",
	]);
	expect(fresh[1].rows.map((row) => row.say)).toEqual([
		"all markets",
		"ETH on every venue",
		"venues by volume",
		"RWA markets",
	]);
	expect(fresh[1].rows[1].run).toBe("mob market ETH");
	expect(fresh[2].rows.map((row) => row.run)).toEqual([
		"mob cost ETH",
		"mob spread hl:BTC lighter-mainnet:BTC",
		"mob history ETH --days 7",
		"mob oil",
	]);
	expect(fresh[3].rows.map((row) => row.say)).toEqual([
		"set up mstack",
		"how does funding work",
		"how do MoB keys work",
	]);
	expect(fresh[3].rows[0]).toEqual({
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
	const base = { owner, hasKey: true, awaiting: [], topPair: { base: "HYPE" } };
	expect(buildMenu(base).state).toBe("trading");
	expect(says(base)).toEqual([
		"open HYPE",
		"my positions",
		"best funding now",
		"raise my cap",
	]);
	// The command column does what the phrase says, flags and all.
	expect(buildMenu(base).rows[0].run).toBe(
		"mob open HYPE --long <venue:market> --short <venue:market> --size <usd>",
	);
	// Four rows at most: a running task puts close in place of the cap row.
	expect(says({ ...base, runningTasks: 2 })).toEqual([
		"open HYPE",
		"my positions",
		"best funding now",
		"close task <id>",
	]);
});

test("a Proposal awaiting signature comes first, then at most three state rows", () => {
	const menu = buildMenu({ owner, hasKey: true, awaiting: ["p-3", "p-4"] });
	expect(menu.state).toBe("awaiting");
	expect(menu.rows[0]).toEqual({
		say: "sign p-3",
		note: "first",
		run: "mob sign p-3",
	});
	expect(menu.rows).toHaveLength(4);
	expect(menu.rows[1].say).toBe("open BTC");
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
