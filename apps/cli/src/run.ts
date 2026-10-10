import { type ParseArgsConfig, parseArgs } from "node:util";
import type { SecretReader } from "@mstack/signers";
import pkg from "../package.json";
import { config } from "./commands/config.ts";
import { explain } from "./commands/explain.ts";
import { history } from "./commands/history.ts";
import { rates } from "./commands/rates.ts";
import {
	type Runtime as CommandRuntime,
	commandError,
	exitFor,
} from "./commands/runtime.ts";
import { scan } from "./commands/scan.ts";
import { readinessStatus, status, statusApi } from "./commands/status.ts";
import { configHome, numberFlag, UsageError } from "./config.ts";
import { footer, pct, renderScan, table } from "./render.ts";
import { renderHistory } from "./render-history.ts";
import { renderStatus, statusFooter } from "./status.ts";
import { installationRoot, upgrade } from "./upgrade.ts";

const help = `mob ${pkg.version} — funding reads and explicit Proposal signing

Usage:
  mob scan [--size N=1000] [--market BASE] [--venues a,b] [--top N=10]
           [--all-pairs] [--executable] [--min-apy PCT] [--strict] [--json | --json-full]
           [--min-volume N=1000000] [--include-thin] [--hold-days N=7] [--top-exec N=5]
  mob rates [--venue V] [--market BASE] [--strict] [--json]
  mob history <BASE> [--days N=7] [--venues a,b] [--strict] [--json]
  mob explain [topic] [--simple]
  mob status [--owner 0x…] [--task ID] [--trims] [--resizes] [--api-base URL] [--json]
  mob config get <key>
  mob config set <key> <value>
  mob keystore create | import | list
  mob proposals
  mob proposal show <id>
  mob preview <id>
  mob sign <id> [--with keystore|browser]
  mob reject <id>
  mob open <BASE> --long venue:market --short venue:market --size USD
           [--protect pct|off --assume-leverage L[,S]] [--auto-close on|off]
           [--min-apy N] [--max-spread-bps N=50] [--size-mismatch pct]
  mob close <task>
  mob neutralize <task>
  mob resize <task> [--long base] [--short base]
  mob protect <task> <pct|off>
  mob auto-close <task> on|off [--min-apy N]
  mob size-mismatch-close <task> on|off --pct N
  mob status --readiness [--owner 0x…] [--json]
  mob upgrade
  mob mcp
  mob --version
  mob --help

Venues: hl,lighter,lighter-mainnet,aster,binance,bybit,okx
Config keys: api_base, owner, signer, policy, default_size_usd, taker_fee_bps.<venue>, builder_fee_tenths_bps
Keystore secrets are read only from /dev/tty. Mutation commands stage, preview, and stop before signing.
MCP tools stage Proposals; no sign, reject, or config-set tool is exposed.
Protection at open requires assumed leverage, not verified on the venue. Leverage and margin mode are never set by these commands.
Browser signing can start from an agent's shell; the human approves in the wallet.
Fee defaults are estimates. Annualized rates are simple, not compounded.
Scan --json returns counts and bounded views. --json-full includes every opportunity and can exceed 3 MB.
Scan --top and --top-exec are capped at 200 each.
Exit: 0 success, 1 usage/request error, 2 no venue rates, 3 partial failure with --strict.`;

const flag = (type: "string" | "boolean") => ({ type });
const common = {
	json: flag("boolean"),
	strict: flag("boolean"),
	help: flag("boolean"),
};
const definitions: Record<string, ParseArgsConfig["options"]> = {
	open: {
		help: flag("boolean"),
		long: flag("string"),
		short: flag("string"),
		size: flag("string"),
		protect: flag("string"),
		"assume-leverage": flag("string"),
		"auto-close": flag("string"),
		"min-apy": flag("string"),
		"max-spread-bps": flag("string"),
		"size-mismatch": flag("string"),
	},
	close: { help: flag("boolean") },
	neutralize: { help: flag("boolean") },
	resize: {
		help: flag("boolean"),
		long: flag("string"),
		short: flag("string"),
	},
	protect: { help: flag("boolean") },
	"auto-close": { help: flag("boolean"), "min-apy": flag("string") },
	"size-mismatch-close": { help: flag("boolean"), pct: flag("string") },
	keystore: { help: flag("boolean") },
	proposals: { help: flag("boolean") },
	proposal: { help: flag("boolean") },
	preview: { help: flag("boolean") },
	sign: { help: flag("boolean"), with: flag("string") },
	reject: { help: flag("boolean") },
	scan: {
		...common,
		"json-full": flag("boolean"),
		size: flag("string"),
		market: flag("string"),
		venues: flag("string"),
		top: flag("string"),
		"top-exec": flag("string"),
		"hold-days": flag("string"),
		"all-pairs": flag("boolean"),
		executable: flag("boolean"),
		"min-apy": flag("string"),
		"min-volume": flag("string"),
		"include-thin": flag("boolean"),
	},
	rates: { ...common, venue: flag("string"), market: flag("string") },
	history: { ...common, days: flag("string"), venues: flag("string") },
	explain: { help: flag("boolean"), simple: flag("boolean") },
	status: {
		readiness: flag("boolean"),
		json: flag("boolean"),
		help: flag("boolean"),
		owner: flag("string"),
		task: flag("string"),
		trims: flag("boolean"),
		resizes: flag("boolean"),
		"api-base": flag("string"),
	},
	config: { help: flag("boolean") },
	upgrade: { help: flag("boolean") },
	mcp: { help: flag("boolean") },
};

export interface Runtime extends CommandRuntime {
	readSecret?: SecretReader;
	openUrl?: (url: string) => Promise<void>;
	out: (text: string) => void;
	err: (text: string) => void;
}

function display(
	rt: Runtime,
	data: unknown,
	human: string,
	ending: string,
	json: boolean,
): void {
	rt.out(json ? JSON.stringify(data, null, 2) : `${human}\n${ending}`);
	if (json) rt.err(ending);
}

export async function run(
	args: string[],
	supplied: Partial<Runtime> = {},
): Promise<number> {
	const rt: Runtime = {
		fetch: globalThis.fetch,
		now: Date.now,
		home: configHome(),
		out: console.log,
		err: console.error,
		...supplied,
	};
	try {
		if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
			rt.out(help);
			return 0;
		}
		if (args.length === 1 && args[0] === "--version") {
			rt.out(pkg.version);
			return 0;
		}
		const command = args[0];
		if (!Object.hasOwn(definitions, command))
			throw new UsageError(`Unknown command ${command}. Run mob --help.`);
		const { values: parsedValues, positionals } = parseArgs({
			args: args.slice(1),
			options: definitions[command],
			allowPositionals: true,
			strict: true,
		});
		const values = parsedValues as Record<string, string | boolean | undefined>;
		if (values.help) {
			rt.out(help);
			return 0;
		}
		const text = (name: string) => values[name] as string | undefined;
		const number = (name: string, minimum: number, integer = false) =>
			text(name) === undefined
				? undefined
				: numberFlag(text(name) as string, name, minimum, integer);
		const json = values.json === true || values["json-full"] === true;
		const strict = values.strict === true;
		if (
			[
				"open",
				"close",
				"neutralize",
				"resize",
				"protect",
				"auto-close",
				"size-mismatch-close",
			].includes(command)
		) {
			const { stagePosition } = await import("./positions.ts");
			const { showProposal } = await import("./proposal-view.ts");
			const proposal = await stagePosition(command, positionals, values, rt);
			rt.out(showProposal(proposal));
			rt.out(
				`Stopped before signing. To authorize, name ${proposal.id} and run mob sign ${proposal.id}.`,
			);
			return 0;
		}
		if (
			[
				"keystore",
				"proposals",
				"proposal",
				"preview",
				"sign",
				"reject",
			].includes(command)
		) {
			const { p1 } = await import("./p1.ts");
			await p1(command, positionals, values, rt, rt.readSecret);
			return 0;
		}
		if (command === "mcp") {
			if (positionals.length)
				throw new UsageError("mcp does not accept positional arguments");
			const { serveMcp } = await import("./mcp.ts");
			await serveMcp(rt);
			return 0;
		}
		if (command === "upgrade") {
			if (positionals.length)
				throw new UsageError("upgrade does not accept positional arguments");
			rt.out(await upgrade(await installationRoot()));
			return 0;
		}
		if (command === "explain") {
			if (positionals.length > 1)
				throw new UsageError("explain accepts at most one topic");
			rt.out(
				await explain(
					{ topic: positionals[0], simple: values.simple === true },
					rt,
				),
			);
			return 0;
		}
		if (command === "config") {
			const [action, key, value] = positionals;
			if (
				!key ||
				(action === "get"
					? positionals.length !== 2
					: action !== "set" || positionals.length !== 3)
			)
				throw new UsageError("Usage: mob config get <key> | set <key> <value>");
			rt.out(
				String(
					await config(
						action === "get" ? { action, key } : { action: "set", key, value },
						rt,
					),
				),
			);
			return 0;
		}
		if (positionals.length !== (command === "history" ? 1 : 0))
			throw new UsageError(
				command === "history"
					? "Usage: mob history <BASE> [--days N]"
					: `${command} does not accept positional arguments`,
			);
		if (command === "status") {
			if (values.readiness) {
				if (values.task || values.trims || values.resizes)
					throw new UsageError(
						"--readiness cannot be combined with --task, --trims or --resizes",
					);
				const result = await readinessStatus(
					{ owner: text("owner"), apiBase: text("api-base") },
					rt,
				);
				rt.out(
					json
						? JSON.stringify(result, null, 2)
						: table(
								["venue", "ready", "issue", "rebind allowed", "rebind detail"],
								result.map((r) => [
									r.venue,
									r.ready,
									r.error ?? "ready",
									r.rebindAllowed ?? "unknown",
									r.rebindError ?? "allowed",
								]),
							),
				);
				return result.every((r) => r.ready) ? 0 : 1;
			}
			const result = await status(
				{
					owner: text("owner"),
					taskId: text("task"),
					trims: values.trims === true,
					resizes: values.resizes === true,
					apiBase: text("api-base"),
				},
				rt,
			);
			display(
				rt,
				result,
				renderStatus(result),
				statusFooter(result, statusApi(result), rt.now()),
				json,
			);
			return 0;
		}
		if (command === "scan") {
			const result = await scan(
				{
					sizeUsd: number("size", Number.MIN_VALUE),
					market: text("market"),
					venues: text("venues")?.split(","),
					top: number("top", 1),
					topExec: number("top-exec", 1),
					holdDays: number("hold-days", Number.MIN_VALUE),
					minVolume24hUsd: number("min-volume", 0),
					minApy: number("min-apy", -Number.MAX_VALUE),
					allPairs: values["all-pairs"] === true,
					executable: values.executable === true,
					includeThin: values["include-thin"] === true,
					includeFull: values["json-full"] === true,
				},
				rt,
			);
			display(
				rt,
				result,
				renderScan(result.view, values.executable === true, result.holdDays),
				`${footer(result, result.unmatched.length, rt.now())} | thin hidden: ${result.counts.thinHidden}`,
				json,
			);
			return exitFor(result, strict);
		}
		if (command === "rates") {
			const result = await rates(
				{ venue: text("venue"), market: text("market") },
				rt,
			);
			display(
				rt,
				result,
				table(
					["venue:market", "interval h", "rate/hour", "annualized", "mark"],
					result.view.map((r) => [
						`${r.venue}:${r.market}`,
						r.intervalHours,
						pct(r.ratePerHour * 100, 6),
						pct(r.annualizedPct, 2),
						r.markPrice,
					]),
				),
				footer(result, result.unmatched.length, rt.now()),
				json,
			);
			return exitFor(result, strict);
		}
		const result = await history(
			{
				base: positionals[0],
				days: number("days", Number.MIN_VALUE),
				venues: text("venues")?.split(","),
			},
			rt,
		);
		const rendered = renderHistory(result, rt.now());
		display(rt, result, rendered.human, rendered.ending, json);
		return exitFor(result, strict);
	} catch (error) {
		rt.err(commandError(error));
		return 1;
	}
}
