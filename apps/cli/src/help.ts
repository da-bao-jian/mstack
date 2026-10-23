import { type ParseArgsConfig, parseArgs } from "node:util";
import { UsageError } from "./config.ts";

const examples: Record<string, [string, string]> = {
	hello: ["mob hello --offline", "mob hello --compact"],
	doctor: ["mob doctor", "mob doctor --json"],
	menu: ["mob menu", "mob menu --json"],
	scan: [
		"mob scan --size 5000 --top 5",
		"mob scan --by price --kind dex --min-oi 1000000",
	],
	venues: ["mob venues", "mob venues --kind dex --json"],
	markets: ["mob markets --top 20", "mob markets --rwa --category commodity"],
	market: ["mob market BTC", "mob market XAU --json"],
	oil: ["mob oil", "mob oil --json"],
	spread: [
		"mob spread hl:BTC lighter:BTC",
		"mob spread hl:xyz:CL hl:xyz:BRENTOIL --interval 4h --days 30",
	],
	cost: ["mob cost BTC", "mob cost NVDA --size 250000 --side short"],
	watch: ["mob watch", "mob watch add BTC --long lighter:BTC --short hl:BTC"],
	rates: ["mob rates --venue hl", "mob rates --market BTC --json"],
	history: [
		"mob history BTC --days 7",
		"mob history ETH --venues hl,binance --json",
	],
	explain: ["mob explain funding --simple", "mob explain liquidation"],
	status: ["mob status --json", "mob status --task 1842 --trims"],
	config: ["mob config get owner", "mob config set default_size_usd 5000"],
	setup: [
		"mob setup",
		"mob setup --owner 0x0000000000000000000000000000000000000001 --signer browser --policy manual",
	],
	onboard: ["mob onboard", "mob onboard --owner 0x… --venues hl,lighter"],
	bind: ["mob bind hl", "mob bind lighter"],
	"bind --all": [
		"mob bind --all",
		"mob bind --all --venues hl,lighter --rebind",
	],
	keys: ["mob keys show", "mob keys list"],
	"keys import": [
		"printf '%s' 'mobius_…' | mob keys import --stdin --name agent --venues hl,lighter --max-size 5000",
		"mob keys import",
	],
	"keys create": [
		"mob keys create --name terminal --venues hl,lighter --max-size 5000",
		"mob keys create --name desk --venues hl,aster --max-size 1000",
	],
	"keys list": ["mob keys list", "mob keys list --json"],
	"keys revoke": ["mob keys revoke <uuid>", "mob keys revoke <uuid> --json"],
	"keys show": ["mob keys show", "mob keys show --json"],
	"keys delete": ["mob keys delete", "mob keys delete --json"],
	keystore: ["mob keystore create", "mob keystore list"],
	"keystore create": ["mob keystore create", "mob keystore create --help"],
	"keystore import": ["mob keystore import", "mob keystore import --help"],
	"keystore list": ["mob keystore list", "mob keystore list --help"],
	proposals: ["mob proposals", "mob proposals --json"],
	proposal: ["mob proposal show p-1", "mob proposal show p-1 --json"],
	"proposal show": ["mob proposal show p-1", "mob proposal show p-1 --json"],
	preview: ["mob preview p-1", "mob preview p-1 --json"],
	sign: ["mob sign p-1", "mob sign p-1 --with browser"],
	"sign c-N": ["mob sign c-1", "mob sign c-1 --with browser"],
	submit: ["mob submit p-1", "mob submit p-1 --json"],
	reject: ["mob reject p-1", "mob reject p-2"],
	open: [
		"mob open BTC --long lighter:BTC --short hl:BTC --size 1000",
		"mob open ETH --long lighter:ETH --short hl:ETH --size 5000 --protect 8 --assume-leverage 2",
	],
	close: ["mob close 1842", "mob close 1842 --json"],
	cancel: ["mob cancel 1842", "mob cancel 1842 --json"],
	neutralize: ["mob neutralize 1842", "mob neutralize 1842 --json"],
	resize: [
		"mob resize 1842 --long 0.1",
		"mob resize 1842 --long 0.1 --short 0.1",
	],
	protect: ["mob protect 1842 8", "mob protect 1842 off"],
	"auto-close": [
		"mob auto-close 1842 on --min-apy 5",
		"mob auto-close 1842 off",
	],
	"size-mismatch-close": [
		"mob size-mismatch-close 1842 on --pct 5",
		"mob size-mismatch-close 1842 off --pct 5",
	],
	upgrade: ["mob upgrade", "mob upgrade --help"],
	mcp: ["mob mcp", "mob mcp --help"],
	hook: [
		"mob hook sign-guard < hook-input.json",
		'printf \'%s\' \'{"tool_input":{"command":"mob scan"}}\' | mob hook sign-guard',
	],
	"hook sign-guard": [
		"mob hook sign-guard < hook-input.json",
		'printf \'%s\' \'{"tool_input":{"command":"mob scan"}}\' | mob hook sign-guard',
	],
	"config get": ["mob config get owner", "mob config get policy"],
	"config set": [
		"mob config set default_size_usd 5000",
		"mob config set policy manual",
	],
};

const usageOverrides: Record<string, string[]> = {
	"bind --all": ["  mob bind --all [--venues a,b] [--rebind]"],
	"config get": ["  mob config get <key>"],
	"config set": ["  mob config set <key> <value>"],
	"hook sign-guard": ["  mob hook sign-guard"],
	"keys create": [
		"  mob keys create --name <n> --venues a,b[,c,d] --max-size <usd>",
	],
	"keys delete": ["  mob keys delete"],
	"keys import": [
		"  mob keys import [--stdin] [--unverified] [--name <n>] [--venues a,b] [--max-size <usd>]",
	],
	"keys list": ["  mob keys list"],
	"keys revoke": ["  mob keys revoke <uuid>"],
	"keys show": ["  mob keys show [--json]"],
	"keystore create": ["  mob keystore create"],
	"keystore import": ["  mob keystore import"],
	"keystore list": ["  mob keystore list"],
	"proposal show": ["  mob proposal show <id>"],
	"sign c-N": ["  mob sign c-N [--with keystore|browser|walletconnect]"],
};

export const helpInvocations: string[][] = [
	["bind", "--all"],
	["config", "get"],
	["config", "set"],
	["hook", "sign-guard"],
	...["import", "create", "list", "revoke", "show", "delete"].map((action) => [
		"keys",
		action,
	]),
	...["create", "import", "list"].map((action) => ["keystore", action]),
	["proposal", "show"],
	["sign", "c-1"],
];

export function helpTopic(
	command: string,
	positionals: string[],
	values: Record<string, string | boolean | undefined>,
): string {
	if (command === "bind" && values.all === true) return "bind --all";
	if (command === "sign" && /^c-[1-9]\d*$/.test(positionals[0] ?? ""))
		return "sign c-N";
	const action = positionals[0];
	if (
		action &&
		["keys", "keystore", "config", "proposal", "hook"].includes(command) &&
		Object.hasOwn(examples, `${command} ${action}`)
	)
		return `${command} ${action}`;
	return command;
}
const defaults: Record<string, string> = {
	size: "config default_size_usd, initially 1000",
	"open.size": "required",
	"open.long": "required",
	"open.short": "required",
	top: "10",
	"top-exec": "5",
	"hold-days": "7",
	"min-volume": "1000000",
	days: "7",
	"scan.min-apy": "no filter",
	by: "funding",
	"markets.top": "25",
	"markets.min-volume": "0",
	"markets.sort": "volume",
	"cost.size": "10000,100000,1000000",
	side: "long",
	interval: "1h",
	"min-apy": "0",
	"max-spread-bps": "50",
	policy: "manual in interactive setup",
	"legal-chain-id": "97",
	"auth-base": "https://auth.mob.exchange",
	"api-base": "https://funding.mob.exchange",
	"strategy-api-base": "https://api.mob.exchange",
	owner: "config owner",
	with: "config signer",
};
export function commandHelp(
	command: string,
	options: ParseArgsConfig["options"],
	overview: string,
) {
	const usage: string[] = usageOverrides[command] ?? [];
	let matching = false;
	for (const line of usage.length ? [] : overview.split("\n")) {
		if (/^ {2}mob /.test(line))
			matching = new RegExp(`^  mob ${command}(?: |$)`).test(line);
		else if (!/^ {4}/.test(line)) matching = false;
		if (matching) usage.push(line);
	}
	return [
		`Usage:`,
		...(usage.length ? usage : [`  mob ${command}`]),
		"",
		"Flags:",
		...Object.entries(options ?? {}).map(
			([name, option]) =>
				`  --${name}${option.type === "string" ? " <value>" : ""} (default: ${defaults[`${command}.${name}`] ?? defaults[name] ?? (option.type === "boolean" ? "off" : "unset")})`,
		),
		"",
		"Examples:",
		...(examples[command] ?? [`mob ${command}`, `mob ${command} --help`]).map(
			(example) => `  ${example}`,
		),
	].join("\n");
}
function distance(a: string, b: string): number {
	let row = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 0; i < a.length; i++) {
		const next = [i + 1];
		for (let j = 0; j < b.length; j++)
			next.push(
				Math.min(next[j] + 1, row[j + 1] + 1, row[j] + Number(a[i] !== b[j])),
			);
		row = next;
	}
	return row[b.length];
}
export function parseCommand(
	command: string,
	args: string[],
	options: ParseArgsConfig["options"],
) {
	try {
		return parseArgs({ args, options, allowPositionals: true, strict: true });
	} catch (error) {
		const e = error as Error & { code?: string };
		const option =
			e.message.match(/['"](-[^'"\s]+)['"]/)?.[1] ??
			args.find((arg) => arg.startsWith("-") && arg !== "--");
		const see = `See \`mob ${command} --help\`.`;
		if (e.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" && option) {
			const nearest = Object.keys(options ?? {}).sort(
				(a, b) => distance(option.slice(2), a) - distance(option.slice(2), b),
			)[0];
			const suggestion =
				nearest && distance(option.slice(2), nearest) <= 2
					? ` Did you mean --${nearest}?`
					: "";
			throw new UsageError(`Unknown option ${option}.${suggestion} ${see}`);
		}
		if (e.code?.startsWith("ERR_PARSE_ARGS"))
			throw new UsageError(`Invalid value for ${option ?? "option"}. ${see}`);
		throw error;
	}
}
