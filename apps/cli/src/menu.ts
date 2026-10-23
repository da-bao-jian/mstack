// What the user can do now, by account state: the words to say in chat and
// the command to run in a terminal. The welcome, `mob menu` and the skill
// preamble all print it, so every invocation offers the right next steps.
// It reads only local state: no network, so it is safe in every preamble.
// `rows` is the short list (one per section) for the welcome and the end of
// a reply. `sections` is the full menu: the router asks for a section first,
// then for a row in it. A Claude Code question holds four options, so there
// are four sections of at most four rows.
// Labels name what a row does and never change with market data: a row that
// needs an asset has `pick`, and the router asks for the asset after it.

export interface MenuRow {
	/** What to say in chat. */
	say: string;
	/** A short reason shown after the phrase, such as "to trade". */
	note?: string;
	/** The equivalent terminal command. */
	run: string;
	/** What the row gives, the picker's option description. */
	about?: string;
	/** The words to say once the user picks an asset, with `<asset>`. */
	pick?: string;
}
interface AssetChoice {
	ticker: string;
	name: string;
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
	/** The assets offered after a row with `pick`; any ticker also works. */
	assets: AssetChoice[];
}
export interface MenuInput {
	owner: string | null;
	/** A MoB API key is stored locally, so onboarding finished. */
	hasKey: boolean;
	/** Proposal or ceremony ids awaiting a signature, oldest first. */
	awaiting: string[];
	runningTasks?: number;
}

const ASSETS: AssetChoice[] = [
	{ ticker: "BTC", name: "Bitcoin" },
	{ ticker: "ETH", name: "Ether" },
	{ ticker: "SOL", name: "Solana" },
	{ ticker: "HYPE", name: "Hyperliquid" },
];

/** A `pick` row filled with one asset: the example the welcome shows. */
function withAsset(row: MenuRow, ticker: string): MenuRow {
	return {
		say: (row.pick ?? row.say).replaceAll("<asset>", ticker),
		run: row.run.replaceAll("<asset>", ticker),
	};
}

export function buildMenu(input: MenuInput): Menu {
	const trades: MenuRow[] = [
		{
			say: "best funding now",
			run: "mob scan --size 1000",
			about: "delta-neutral pairs ranked by net APY after fees",
		},
		{
			say: "best price gaps now",
			run: "mob scan --by price",
			about: "the same asset priced apart across venues",
		},
		{
			say: "RWA funding farms",
			run: "mob scan --rwa",
			about: "funding pairs on stocks, gold, oil and FX",
		},
		{
			say: "my watchlist",
			run: "mob watch",
			about: "saved pairs, their spreads and alerts",
		},
	];
	const markets: MenuRow[] = [
		{
			say: "all markets",
			run: "mob markets",
			about: "every asset on every venue: volume, open interest, best funding",
		},
		{
			say: "one asset on every venue",
			run: "mob market <asset>",
			about: "price, funding and volume per venue; you pick the asset",
			pick: "<asset> on every venue",
		},
		{
			say: "venues by volume",
			run: "mob venues",
			about: "each venue's volume, open interest, fees and MoB support",
		},
		{
			say: "RWA markets",
			note: "stocks, gold, oil, FX",
			run: "mob markets --rwa",
			about: "stock, index, gold, oil, FX and pre-IPO perps",
		},
	];
	const charts: MenuRow[] = [
		{
			say: "cost to trade",
			run: "mob cost <asset>",
			about: "fill cost on each venue's order book; you pick the asset",
			pick: "cost to trade <asset>",
		},
		{
			say: "price spread chart",
			run: "mob spread hl:<asset> lighter-mainnet:<asset>",
			about: "7 days, Hyperliquid vs Lighter; you pick the asset",
			pick: "chart <asset> on Hyperliquid vs Lighter",
		},
		{
			say: "funding history",
			run: "mob history <asset> --days 7",
			about: "7 days of settled funding per venue; you pick the asset",
			pick: "history <asset>",
		},
		{
			say: "WTI vs Brent",
			note: "oil",
			run: "mob oil",
			about: "oil prices and the funding carry on each venue",
		},
	];
	const learn: MenuRow[] = [
		{
			say: "how does funding work",
			run: "mob explain funding",
			about: "funding, delta-neutral pairs and their risks",
		},
		{
			say: "how do MoB keys work",
			run: "mob explain mob-keys",
			about: "scoped keys: venue and USD caps, no withdrawals, revocable",
		},
	];
	const setUp = (note: string): MenuRow => ({
		say: "set up mstack",
		note,
		run: "mob onboard",
		about: "one wallet session, about two minutes",
	});
	let state: MenuState;
	let account: MenuRow[];
	let accountNote: string;
	if (input.hasKey) {
		state = "trading";
		accountNote = "open, positions, close, caps";
		account = [
			{
				say: "open a position",
				run: "mob open <asset> --long <venue:market> --short <venue:market> --size <usd>",
				about: "stage a long and short pair; nothing trades until you approve",
			},
			{
				say: "my positions",
				run: "mob status",
				about: "positions, PnL and running tasks",
			},
			input.runningTasks
				? {
						say: "close a position",
						run: "mob close <task>",
						about: "pick a running task to close",
					}
				: {
						say: "raise my cap",
						run: "mob keys create --name <name> --venues <a,b> --max-size <usd>",
						about: "a new key with a higher USD cap or more venues",
					},
			{
				say: "my key",
				run: "mob keys show",
				about: "the stored key: venues, caps and expiry",
			},
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
			{
				say: `sign ${first}`,
				note: "first",
				run: `mob sign ${first}`,
				about: `${first} waits for your signature`,
			},
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
	// once trading, and closes the list before setup. The welcome shows a
	// say-able example, so the history row names BTC.
	const history = withAsset(charts[2], "BTC");
	const rows =
		state === "fresh" || state === "setting-up"
			? state === "setting-up"
				? [account[0], trades[0], markets[0], history]
				: [trades[0], markets[0], history, account[0]]
			: state === "awaiting"
				? [account[0], ...account.slice(1, 3), trades[0]]
				: [account[0], account[1], trades[0], account[2]];
	return { state, rows, sections, assets: ASSETS };
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
