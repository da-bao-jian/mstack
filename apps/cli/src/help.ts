import { type ParseArgsConfig, parseArgs } from "node:util";
import { UsageError } from "./config.ts";

const examples: Record<string, [string, string]> = {
	hello: ["mob hello --offline", "mob hello --compact"],
	doctor: ["mob doctor", "mob doctor --json"],
	scan: [
		"mob scan --size 5000 --top 5",
		"mob scan --executable --include-cross-deployment --json",
	],
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
	bind: ["mob bind hl", "mob bind lighter"],
	keystore: ["mob keystore create", "mob keystore list"],
	proposals: ["mob proposals", "mob proposals --json"],
	proposal: ["mob proposal show p-1", "mob proposal show p-1 --json"],
	preview: ["mob preview p-1", "mob preview p-1 --json"],
	sign: ["mob sign p-1", "mob sign p-1 --with browser"],
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
};
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
	const usage: string[] = [];
	let matching = false;
	for (const line of overview.split("\n")) {
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
		...examples[command].map((example) => `  ${example}`),
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
