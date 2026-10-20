// What the user can do now, by account state, as the words to say in chat
// and the command to run in a terminal. The welcome, `mob menu` and the skill
// preamble all print it, so every invocation offers the right next steps.
// It reads only local state: no network, so it is safe in every preamble.

export interface MenuRow {
	/** What to say in chat. */
	say: string;
	/** A short reason shown after the phrase, such as "to trade". */
	note?: string;
	/** The equivalent terminal command. */
	run: string;
}
type MenuState = "fresh" | "setting-up" | "awaiting" | "trading";
export interface Menu {
	state: MenuState;
	rows: MenuRow[];
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
	const research: MenuRow[] = [
		{ say: "best funding now", run: "mob scan --size 1000" },
		{ say: "how does funding work", run: "mob explain funding" },
		{ say: `history ${base}`, run: `mob history ${base} --days 7` },
		{ say: "positions of 0x…", run: "mob status --owner 0x…" },
	];
	let state: MenuState;
	let rows: MenuRow[];
	if (input.hasKey) {
		state = "trading";
		rows = [
			{ say: `open ${base}`, run: `mob scan --market ${base}` },
			{ say: "my positions", run: "mob status" },
			research[0],
			...(input.runningTasks
				? [{ say: "close task <id>", run: "mob close <task>" }]
				: []),
			{
				say: "raise my cap",
				run: "mob keys create --name <n> --venues a,b --max-size <usd>",
			},
		];
	} else if (input.owner) {
		state = "setting-up";
		rows = [
			{ say: "set up mstack", note: "finish setup", run: "mob onboard" },
			...research.slice(0, 3),
		];
	} else {
		state = "fresh";
		rows = [
			...research,
			{ say: "set up mstack", note: "to trade", run: "mob onboard" },
		];
	}
	const first = input.awaiting[0];
	if (first)
		return {
			state: "awaiting",
			rows: [
				{ say: `sign ${first}`, note: "first", run: `mob sign ${first}` },
				...rows.slice(0, 3),
			],
		};
	return { state, rows };
}

/** One row as text: the phrase (with its note) padded, then the command. */
export function menuLine(row: MenuRow, width = 30): string {
	return `${`say "${row.say}"${row.note ? ` ${row.note}` : ""}`.padEnd(width)}${row.run}`;
}

/** How to reach mstack from any host; the same words on every surface. */
export const USE_LINE =
	"say a line below in chat, or run its command · /mstack:mob or $mob also start mstack";
