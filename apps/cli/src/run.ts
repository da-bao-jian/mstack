import type { ParseArgsConfig } from "node:util";
import type { SecretReader, WalletConnectFactory } from "@mstack/signers";
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
import { paint } from "./format.ts";
import { withGlossary } from "./glossary.ts";
import { commandHelp, helpTopic, parseCommand } from "./help.ts";
import type { HomeServices } from "./home-data.ts";
import { footer, pct, renderScan, table } from "./render.ts";
import { renderHistory } from "./render-history.ts";
import { renderStatus, statusFooter } from "./status.ts";
import { installationRoot, upgrade } from "./upgrade.ts";

const help = `mob ${pkg.version} — funding reads and explicit Proposal signing

Usage:
  mob [--big | --compact] [--stacked] [--plain | --ascii] [--offline] [--json]
  mob hello [--big | --compact] [--stacked] [--plain | --ascii] [--offline] [--json]
  mob doctor [--json]
  mob scan [--size N=1000] [--market BASE] [--venues a,b] [--top N=10]
           [--all-pairs] [--executable] [--min-apy PCT] [--strict] [--json | --json-full]
           [--min-volume N=1000000] [--include-thin] [--include-cross-deployment]
           [--hold-days N=7] [--top-exec N=5]
  mob rates [--venue V] [--market BASE] [--strict] [--json]
  mob history <BASE> [--days N=7] [--venues a,b] [--strict] [--json]
  mob explain [topic] [--simple]
  mob status [--owner 0x…] [--task ID] [--trims] [--resizes] [--api-base URL] [--json]
  mob config get <key>
  mob config set <key> <value>
  mob setup [--owner 0x… --signer keystore|browser|walletconnect --policy manual|locked|auto]
            [--auth-base URL] [--legal-chain-id N] [--walletconnect-project-id ID] [--no-legal]
  mob onboard [--owner 0x…] [--app-base URL] [--watch] [--native] [--venues a,b]
  mob bind <hl|aster|lighter|lighter-mainnet>
  mob keys import [--stdin] [--unverified] [--name <n>] [--venues a,b] [--max-size <usd>]
  mob keys create --name <n> --venues a,b[,c,d] --max-size <usd>
  mob keys list | revoke <uuid> | show [--json] | delete
  mob keystore create | import | list
  mob proposals
  mob proposal show <id>
  mob preview <id>
  mob sign <id> [--with keystore|browser|walletconnect]
  mob submit <id>
  mob reject <id>
  mob open <BASE> --long venue:market --short venue:market --size USD
           [--protect pct|off --assume-leverage L[,S]] [--auto-close on|off]
           [--min-apy N] [--max-spread-bps N=50] [--size-mismatch pct]
  mob close <task>
  mob cancel <task>
  mob neutralize <task>
  mob resize <task> [--long base] [--short base]
  mob protect <task> <pct|off>
  mob auto-close <task> on|off [--min-apy N]
  mob size-mismatch-close <task> on|off --pct N
  mob status --readiness [--owner 0x…] [--json]
  mob upgrade
  mob mcp
  mob hook sign-guard
  mob --version
  mob --help

Venues: hl,lighter,lighter-mainnet,aster,binance,bybit,okx
Config keys: api_base, strategy_api_base, auth_base, app_base, legal_chain_id, hl_signature_chain_id, owner, signer, policy, key_store, walletconnect_project_id, default_size_usd, taker_fee_bps.<venue>, builder_fee_tenths_bps
Keystore secrets are read only from /dev/tty. Mutation commands stage, preview, and stop before signing.
MCP tools stage Proposals; no sign, reject, or config-set tool is exposed.
Protection at open requires assumed leverage, not verified on the venue. Leverage and margin mode are never set by these commands.
Browser and WalletConnect signing can start from an agent's shell; the human approves in the wallet.
WalletConnect requires walletconnect_project_id from cloud.reown.com; there is no default.
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
export const definitions: Record<string, ParseArgsConfig["options"]> = {
	hook: { help: flag("boolean") },
	hello: {
		help: flag("boolean"),
		big: flag("boolean"),
		compact: flag("boolean"),
		stacked: flag("boolean"),
		plain: flag("boolean"),
		ascii: flag("boolean"),
		offline: flag("boolean"),
		json: flag("boolean"),
	},
	doctor: { help: flag("boolean"), json: flag("boolean") },
	setup: {
		help: flag("boolean"),
		owner: flag("string"),
		signer: flag("string"),
		policy: flag("string"),
		"auth-base": flag("string"),
		"legal-chain-id": flag("string"),
		"walletconnect-project-id": flag("string"),
		"no-legal": flag("boolean"),
	},
	onboard: {
		help: flag("boolean"),
		owner: flag("string"),
		"app-base": flag("string"),
		watch: flag("boolean"),
		native: flag("boolean"),
		venues: flag("string"),
		"lighter-account": flag("string"),
		rebind: flag("boolean"),
	},
	bind: {
		help: flag("boolean"),
		all: flag("boolean"),
		venues: flag("string"),
		"lighter-account": flag("string"),
		rebind: flag("boolean"),
	},
	keys: {
		help: flag("boolean"),
		json: flag("boolean"),
		unverified: flag("boolean"),
		stdin: flag("boolean"),
		"from-env": flag("boolean"),
		name: flag("string"),
		venues: flag("string"),
		"max-size": flag("string"),
	},
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
	cancel: { help: flag("boolean") },
	neutralize: { help: flag("boolean") },
	resize: {
		help: flag("boolean"),
		long: flag("string"),
		short: flag("string"),
		"disable-size-mismatch-auto-close": flag("boolean"),
	},
	protect: { help: flag("boolean") },
	"auto-close": { help: flag("boolean"), "min-apy": flag("string") },
	"size-mismatch-close": { help: flag("boolean"), pct: flag("string") },
	keystore: { help: flag("boolean") },
	proposals: { help: flag("boolean") },
	proposal: { help: flag("boolean") },
	preview: { help: flag("boolean") },
	sign: { help: flag("boolean"), with: flag("string") },
	submit: { help: flag("boolean"), json: flag("boolean") },
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
		"include-cross-deployment": flag("boolean"),
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
for (const command of [
	"open",
	"close",
	"cancel",
	"neutralize",
	"resize",
	"protect",
	"auto-close",
	"size-mismatch-close",
	"proposals",
	"proposal",
	"preview",
	"reject",
]) {
	const options = definitions[command];
	if (options) options.json = flag("boolean");
}

export interface Runtime extends CommandRuntime {
	readStdin?: () => Promise<string>;
	env?: Record<string, string | undefined>;
	isTTY?: boolean;
	columns?: number;
	homeServices?: HomeServices;
	stdinIsTTY?: boolean;
	stdoutIsTTY?: boolean;
	writeStatus?: (text: string) => void;
	sleep?: (ms: number) => Promise<void>;
	prompt?: (question: string, defaultValue: string) => Promise<string>;
	readSecret?: SecretReader;
	openUrl?: (url: string) => Promise<void>;
	walletConnectClientFactory?: WalletConnectFactory;
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
	rt.out(
		json
			? JSON.stringify(withGlossary(data), null, 2)
			: `${human}\n${paint(ending, "dim", rt)}`,
	);
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
		stdinIsTTY: supplied.prompt !== undefined || !!process.stdin.isTTY,
		stdoutIsTTY: supplied.isTTY ?? !!process.stdout.isTTY,
		writeStatus: (text) => {
			process.stdout.write(text);
		},
		...supplied,
	};
	try {
		if (args.length === 1 && args[0] === "--help") {
			rt.out(help);
			return 0;
		}
		if (args.length === 1 && args[0] === "--version") {
			rt.out(pkg.version);
			return 0;
		}
		if (!args.length || args[0].startsWith("--")) args = ["hello", ...args];
		const command = args[0];
		if (!Object.hasOwn(definitions, command))
			throw new UsageError(`Unknown command ${command}. Run mob --help.`);
		const { values: parsedValues, positionals } = parseCommand(
			command,
			args.slice(1),
			definitions[command],
		);
		const values = parsedValues as Record<string, string | boolean | undefined>;
		if (values.help) {
			rt.out(
				commandHelp(
					helpTopic(command, positionals, values),
					definitions[command],
					help,
				),
			);
			return 0;
		}
		const text = (name: string) => values[name] as string | undefined;
		const number = (name: string, minimum: number, integer = false) =>
			text(name) === undefined
				? undefined
				: numberFlag(text(name) as string, name, minimum, integer);
		const json = values.json === true || values["json-full"] === true;
		const strict = values.strict === true;
		if (command === "hook") {
			if (positionals.length !== 1 || positionals[0] !== "sign-guard")
				throw new UsageError("Usage: mob hook sign-guard");
			const { signGuard } = await import("./sign-guard.ts");
			return signGuard(
				await (rt.readStdin?.() ?? Bun.stdin.text()),
				rt.err,
				rt.home,
			);
		}
		if (command === "hello" || command === "doctor") {
			if (positionals.length)
				throw new UsageError(`${command} takes no positional arguments`);
			const { home, doctor } = await import("./home.ts");
			if (command === "doctor") return doctor(json, rt);
			await home(
				{
					big: values.big === true,
					compact: values.compact === true,
					stacked: values.stacked === true,
					plain: values.plain === true,
					ascii: values.ascii === true,
					offline: values.offline === true,
					json,
				},
				rt,
			);
			return 0;
		}
		if (
			[
				"open",
				"close",
				"cancel",
				"neutralize",
				"resize",
				"protect",
				"auto-close",
				"size-mismatch-close",
			].includes(command)
		) {
			const { stagePosition } = await import("./positions.ts");
			const { showProposal, proposalView } = await import("./proposal-view.ts");
			const proposal = await stagePosition(command, positionals, values, rt);
			rt.out(
				json
					? JSON.stringify(proposalView(proposal), null, 2)
					: showProposal(proposal, rt.now(), rt),
			);
			if (json) return 0;
			rt.out(
				proposal.kind === "api-submit"
					? `Staged for API-key submission. Next: mob submit ${proposal.id}`
					: `Stopped before signing. To authorize, name ${proposal.id} and run mob sign ${proposal.id}.`,
			);
			return 0;
		}
		if (command === "submit") {
			if (positionals.length !== 1)
				throw new UsageError("Usage: mob submit <id>");
			const { submitCommand } = await import("./submit-command.ts");
			await submitCommand(positionals[0], json, rt);
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
		if (command === "setup") {
			if (positionals.length) throw new UsageError("Usage: mob setup");
			const { setupCommand } = await import("./setup-command.ts");
			await setupCommand(rt, values);
			return 0;
		}
		if (command === "onboard") {
			if (positionals.length) throw new UsageError("Usage: mob onboard");
			const { onboard } = await import("./onboard.ts");
			await onboard(values, rt);
			return 0;
		}
		if (command === "bind") {
			if (values.all === true) {
				if (positionals.length)
					throw new UsageError("Usage: mob bind --all [--venues a,b]");
				const { stageCeremony } = await import("./ceremony-command.ts");
				await stageCeremony(values, rt);
				return 0;
			}
			if (positionals.length !== 1)
				throw new UsageError(
					"Usage: mob bind <hl|aster|lighter|lighter-mainnet>",
				);
			const { bindCommand } = await import("./bind-command.ts");
			await bindCommand(positionals[0], rt);
			return 0;
		}
		if (command === "keys") {
			const { keysCommand } = await import("./keys-command.ts");
			await keysCommand(positionals, values, rt, rt.readSecret);
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
			const result = await config(
				action === "get" ? { action, key } : { action: "set", key, value },
				rt,
			);
			if (result !== "" || rt.stdoutIsTTY)
				rt.out(result === "" ? "(unset)" : String(result));
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
						? JSON.stringify(result.map(withGlossary), null, 2)
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
				renderStatus(result, rt.now(), rt),
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
					includeCrossDeployment: values["include-cross-deployment"] === true,
					includeFull: values["json-full"] === true,
				},
				rt,
			);
			display(
				rt,
				result,
				renderScan(
					result.view,
					values.executable === true,
					result.holdDays,
					rt,
				),
				`${footer(result, result.unmatched.length, rt.now())}\nthin hidden: ${result.counts.thinHidden} (--include-thin) · cross-deployment hidden: ${result.counts.crossDeploymentHidden} (--include-cross-deployment)`,
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
						pct(r.ratePerHour * 100, 4),
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
