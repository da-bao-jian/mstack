// What the user can do now, by account state: the words to say in chat and
// the command to run in a terminal. The welcome, `mob menu` and the skill
// preamble all print it, so every invocation offers the right next steps.
// It reads only local state: no network, so it is safe in every preamble.
// `rows` is the short list (one per section) for the welcome and the end of
// a reply. `sections` is the full menu: the router asks for a section first,
// then for a row in it. A Claude Code question holds four options, so there
// are four sections of at most four rows.

export interface MenuRow {
	/** What to say in chat. */
	say: string;
	/** A short reason shown after the phrase, such as "to trade". */
	note?: string;
	/** The equivalent terminal command. */
	run: string;
}
type MenuState = "fresh" | "setting-up" | "awaiting" | "trading";
interface MenuSection {
	/** The first question's option label. */
	name: string;
	/** What the section holds, the option description. */
	note: string;
	rows: MenuRow[];
}
export interface Menu {
	state: MenuState;
	rows: MenuRow[];
	sections: MenuSection[];
}
export interface MenuInput {
	owner: string | null;
	/** A MoB API key is stored locally, so onboarding finished. */
	hasKey: boolean;
	/** Proposal or ceremony ids awaiting a signature, oldest first. */
	awaiting: string[];
	topPair?: { base: string };
	runningTasks?: number;
}

export function buildMenu(input: MenuInput): Menu {
	const base = input.topPair?.base ?? "BTC";
	const trades: MenuRow[] = [
		{ say: "best funding now", run: "mob scan --size 1000" },
		{ say: "best price gaps now", run: "mob scan --by price" },
		{ say: "RWA funding farms", run: "mob scan --rwa" },
		{ say: "my watchlist", run: "mob watch" },
	];
	const markets: MenuRow[] = [
		{ say: "all markets", run: "mob markets" },
		{ say: `${base} on every venue`, run: `mob market ${base}` },
		{ say: "venues by volume", run: "mob venues" },
		{
			say: "RWA markets",
			note: "stocks, gold, oil, FX",
			run: "mob markets --rwa",
		},
	];
	const charts: MenuRow[] = [
		{ say: `cost to trade ${base}`, run: `mob cost ${base}` },
		{
			say: "chart BTC on Hyperliquid vs Lighter",
			run: "mob spread hl:BTC lighter-mainnet:BTC",
		},
		{ say: `history ${base}`, run: `mob history ${base} --days 7` },
		{ say: "WTI vs Brent", note: "oil", run: "mob oil" },
	];
	const learn: MenuRow[] = [
		{ say: "how does funding work", run: "mob explain funding" },
		{ say: "how do MoB keys work", run: "mob explain venue-keys" },
	];
	const setUp = (note: string): MenuRow => ({
		say: "set up mstack",
		note,
		run: "mob onboard",
	});
	let state: MenuState;
	let account: MenuRow[];
	let accountNote: string;
	if (input.hasKey) {
		state = "trading";
		accountNote = "open, positions, close, caps";
		account = [
			{
				say: `open ${base}`,
				run: `mob open ${base} --long <venue:market> --short <venue:market> --size <usd>`,
			},
			{ say: "my positions", run: "mob status" },
			input.runningTasks
				? { say: "close task <id>", run: "mob close <task>" }
				: {
						say: "raise my cap",
						run: "mob keys create --name <name> --venues <a,b> --max-size <usd>",
					},
			{ say: "my key", run: "mob keys show" },
		];
	} else if (input.owner) {
		state = "setting-up";
		accountNote = "finish the one-time setup to trade through MoB";
		account = [setUp("to finish setup"), ...learn];
	} else {
		state = "fresh";
		accountNote = "one-time setup to trade through MoB";
		account = [setUp("to trade"), ...learn];
	}
	const first = input.awaiting[0];
	if (first) {
		state = "awaiting";
		accountNote = `${first} waits for your signature`;
		account = [
			{ say: `sign ${first}`, note: "first", run: `mob sign ${first}` },
			...account.slice(0, 3),
		];
	}
	const sections: MenuSection[] = [
		{
			name: "Find trades",
			note: "funding arb, price gaps, RWA farms, watchlist",
			rows: trades,
		},
		{
			name: "Explore markets",
			note: "all markets, one asset, venues, RWA",
			rows: markets,
		},
		{
			name: "Charts & costs",
			note: "cost to trade, spread chart, funding history, WTI vs Brent",
			rows: charts,
		},
		{ name: "Trade & account", note: accountNote, rows: account },
	];
	// One row per section; the account row leads while a signature waits or
	// once trading, and closes the list before setup.
	const rows =
		state === "fresh" || state === "setting-up"
			? state === "setting-up"
				? [account[0], trades[0], markets[0], charts[2]]
				: [trades[0], markets[0], charts[2], account[0]]
			: state === "awaiting"
				? [account[0], ...account.slice(1, 3), trades[0]]
				: [account[0], account[1], trades[0], account[2]];
	return { state, rows, sections };
}

/** The phrase column: the words to say in quotes, then the note. */
export function menuPhrase(row: MenuRow): string {
	return `"${row.say}"${row.note ? `  ${row.note}` : ""}`;
}

/** One row as text: the phrase padded to the column, two spaces, the command. */
export function menuLine(row: MenuRow, width = 30): string {
	return `${menuPhrase(row).padEnd(width)}  ${row.run}`;
}

/** The headers above the two columns: "chat" inside a reply, "hosts" in a terminal. */
export function menuHeader(where: "chat" | "hosts"): [string, string] {
	return [
		where === "chat" ? "say in chat" : "say in Claude Code or Codex",
		"or run in a terminal",
	];
}

/** How to reach mstack from an agent; the same words on every surface. */
export const CHAT_LINE =
	"/mstack:mob in Claude Code or $mob in Codex opens this menu";
