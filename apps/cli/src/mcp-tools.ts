import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation/types.js";
import { ProposalStore } from "@mstack/proposals";
import { config } from "./commands/config.ts";
import { explain } from "./commands/explain.ts";
import { type HistoryOptions, history } from "./commands/history.ts";
import { type RatesOptions, rates } from "./commands/rates.ts";
import type { Runtime } from "./commands/runtime.ts";
import { type ScanOptions, scan } from "./commands/scan.ts";
import { type StatusOptions, status } from "./commands/status.ts";
import { UsageError } from "./config.ts";
import { stagePosition } from "./positions.ts";
import { proposalResult } from "./proposal-view.ts";

const readOnly = "Read-only. This tool never signs, trades, or holds keys.";
const validator = new AjvJsonSchemaValidator();
const text = (description: string): JsonSchemaType => ({
	type: "string",
	description,
});
const number = (description: string): JsonSchemaType => ({
	type: "number",
	description,
});
const boolean = (description: string): JsonSchemaType => ({
	type: "boolean",
	description,
});
const venues: JsonSchemaType = {
	type: "array",
	items: { type: "string" },
	description:
		"Venue IDs: hl, lighter, lighter-mainnet, aster, binance, bybit, okx. Omit for all.",
};
const owner = text(
	"Public 20-byte 0x owner address. Defaults to the owner config key.",
);

function tool<T>(
	name: string,
	description: string,
	properties: Record<string, JsonSchemaType>,
	required: string[],
	execute: (options: T, rt: Runtime) => Promise<unknown>,
	staging = false,
) {
	// Structural validation stays here; shared commands enforce all value rules,
	// so CLI and MCP return the same domain and usage error messages.
	const inputSchema = {
		type: "object" as const,
		properties,
		required,
		additionalProperties: false,
	};
	const validate = validator.getValidator<T>(inputSchema);
	const definition: Tool = {
		name,
		description: `${description} ${staging ? "Stages one local Proposal and stops. Never signs, submits, or holds keys. Requires configured owner, signer, and manual policy." : readOnly}`,
		inputSchema,
		annotations: {
			readOnlyHint: !staging,
			destructiveHint: false,
			idempotentHint: !staging,
			openWorldHint: true,
		},
	};
	return {
		definition,
		async call(input: unknown, rt: Runtime) {
			const parsed = validate(input);
			if (!parsed.valid)
				throw new UsageError(
					`Invalid ${name} arguments: ${parsed.errorMessage}`,
				);
			return execute(parsed.data, rt);
		},
	};
}

const optionalString = (value: string | number | undefined) =>
	value === undefined ? undefined : String(value);
const taskId = text("Required owned task ID.");

export const mcpTools = [
	tool<ScanOptions>(
		"funding_scan",
		"Rank current funding with estimated net APY for a hold period. Returns bounded executable/anywhere views, counts, failures and unmatched markets. Annualization is simple, not compounded.",
		{
			sizeUsd: number(
				"Positive USD size. Defaults to default_size_usd config or 1000.",
			),
			market: text("Normalized base ticker; omit to scan all markets."),
			venues,
			topExec: number(
				"Positive integer limit for executable view; default 5, cap 200.",
			),
			top: number(
				"Positive integer limit for anywhere view, or executable-only view; default 10, cap 200.",
			),
			allPairs: boolean(
				"Include every pair instead of the best per base in each view.",
			),
			executable: boolean("Only the executable view, limited by top."),
			minApy: number(
				"Minimum gross simple annualized spread percentage; not the net APY filter.",
			),
			minVolume24hUsd: number(
				"Nonnegative minimum known USD volume per leg; default 1000000.",
			),
			includeThin: boolean(
				"Include below-threshold or unknown-volume pairs in the views.",
			),
			includeCrossDeployment: boolean(
				"Include Lighter cross-deployment pairs in the executable view; default false.",
			),
			holdDays: number(
				"Positive hold horizon in days for fee amortization; default 7.",
			),
			includeFull: boolean(
				"Include the full opportunities array; can exceed 3 MB. Default false keeps only counts and bounded views.",
			),
		},
		[],
		scan,
	),
	tool<RatesOptions>(
		"funding_rates",
		"Read filtered native-market funding observations with hourly and simple annualized rates and snapshot metadata. At least one of venue or market is required; raw rates and listings follow the same filter as the view.",
		{
			venue: text("Venue ID; omit for all venues."),
			market: text("Normalized base ticker; omit for all markets."),
		},
		[],
		async (options, rt) => {
			if (options.venue === undefined && options.market === undefined)
				throw new UsageError(
					"funding_rates requires at least one of venue or market",
				);
			const result = await rates(options, rt);
			const keys = new Set(
				result.view.map((row) => `${row.venue}:${row.market}`),
			);
			return {
				...result,
				rates: result.rates.filter((row) =>
					keys.has(`${row.venue}:${row.market}`),
				),
				listed: result.listed.filter((key) => keys.has(key)),
			};
		},
	),
	tool<HistoryOptions>(
		"funding_history",
		"Read settled keyless funding history, interval-weighted averages, coverage, and the best average spread. Lighter has no keyless history. Annualization is simple, not compounded.",
		{
			base: text("Required normalized base ticker, for example BTC or PEPE."),
			days: number("Positive lookback in days; default 7."),
			venues,
		},
		["base"],
		history,
	),
	tool<{ topic?: string; simple?: boolean }>(
		"explain",
		"Read bundled Markdown about funding, basis, fees, and Mobius protection. Omit topic to list topics.",
		{
			topic: text(
				"Bundled topic name, such as funding, annualization, or liquidation-protection.",
			),
			simple: boolean("Return the plain-language Simple section only."),
		},
		[],
		explain,
	),
	tool<Pick<StatusOptions, "owner">>(
		"task_list",
		"Read public tasks for an owner. Funding accrued is an estimate.",
		{ owner },
		[],
		status,
	),
	tool<StatusOptions>(
		"task_get",
		"Read one public task and optional trim/resize logs. Funding accrued is an estimate.",
		{
			owner,
			taskId: text("Required nonempty task ID."),
			trims: boolean("Include liquidation trim logs."),
			resizes: boolean("Include resize logs."),
		},
		["taskId"],
		status,
	),
	tool<{ key: string }>(
		"config_get",
		"Read a local setting: api_base, strategy_api_base, owner, default_size_usd, taker_fee_bps.<venue>, builder_fee_tenths_bps, signer, or policy. No setting is changed.",
		{ key: text("Config key to read.") },
		["key"],
		({ key }, rt) => config({ action: "get", key }, rt),
	),
	tool<{
		base: string;
		long: string;
		short: string;
		sizeUsd: number;
		protect?: number | "off";
		assumeLeverage?: string;
		autoClose?: boolean;
		minApy?: number;
		maxSpreadBps?: number;
		sizeMismatch?: number;
	}>(
		"propose_open",
		"Stage an open using native venue:market legs and fresh marks. Protection requires assumed leverage; it does not set venue leverage.",
		{
			base: text("Base ticker, for example BTC."),
			long: text("Native long leg, for example hl:BTC or hl:xyz:NVDA."),
			short: text(
				"Native short leg, for example lighter:BTC or aster:USD1:BTC.",
			),
			sizeUsd: number(
				"Required positive USD size per leg, supplied by the human.",
			),
			protect: {
				anyOf: [{ type: "number" }, { const: "off" }],
				description: "Protection percentage, or off (default).",
			},
			assumeLeverage: text(
				"Required with protection: L or L,S, each >= 1. Assumed leverage, not verified on the venue.",
			),
			autoClose: boolean("Enable or disable auto-close."),
			minApy: number(
				"Nonnegative simple annualized funding APY threshold; default 0.",
			),
			maxSpreadBps: number("Positive entry spread cap in bps; default 50."),
			sizeMismatch: number(
				"Size mismatch threshold percentage, 0.5 through 100.",
			),
		},
		["base", "long", "short", "sizeUsd"],
		async (o, rt) =>
			proposalResult(
				await stagePosition(
					"open",
					[o.base],
					{
						long: o.long,
						short: o.short,
						size: String(o.sizeUsd),
						protect: optionalString(o.protect),
						"assume-leverage": o.assumeLeverage,
						"auto-close":
							o.autoClose === undefined
								? undefined
								: o.autoClose
									? "on"
									: "off",
						"min-apy": optionalString(o.minApy),
						"max-spread-bps": optionalString(o.maxSpreadBps),
						"size-mismatch": optionalString(o.sizeMismatch),
					},
					rt,
				),
			),
		true,
	),
	...(["close", "neutralize"] as const).map((command) =>
		tool<{ taskId: string }>(
			`propose_${command}`,
			`Stage ${command} for one owned task.`,
			{ taskId },
			["taskId"],
			async (o, rt) =>
				proposalResult(await stagePosition(command, [o.taskId], {}, rt)),
			true,
		),
	),
	tool<{ taskId: string; long?: number; short?: number }>(
		"propose_resize",
		"Stage new base amounts for a running task, quantized toward its current sizes.",
		{
			taskId,
			long: number("New long base amount; positive."),
			short: number(
				"New short base amount; positive. Supply at least one leg.",
			),
		},
		["taskId"],
		async (o, rt) =>
			proposalResult(
				await stagePosition(
					"resize",
					[o.taskId],
					{ long: optionalString(o.long), short: optionalString(o.short) },
					rt,
				),
			),
		true,
	),
	tool<{ taskId: string; pct: number | "off" }>(
		"propose_protect",
		"Stage protection for a running task.",
		{
			taskId,
			pct: {
				anyOf: [{ type: "number" }, { const: "off" }],
				description: "Protection percentage in (0, 100], or off.",
			},
		},
		["taskId", "pct"],
		async (o, rt) =>
			proposalResult(
				await stagePosition("protect", [o.taskId, String(o.pct)], {}, rt),
			),
		true,
	),
	tool<{ taskId: string; enabled: boolean; minApy?: number }>(
		"propose_auto_close",
		"Stage auto-close for a running task.",
		{
			taskId,
			enabled: boolean("Enable or disable auto-close."),
			minApy: number(
				"Nonnegative simple annualized funding APY threshold; default 0.",
			),
		},
		["taskId", "enabled"],
		async (o, rt) =>
			proposalResult(
				await stagePosition(
					"auto-close",
					[o.taskId, o.enabled ? "on" : "off"],
					{ "min-apy": optionalString(o.minApy) },
					rt,
				),
			),
		true,
	),
	tool<{ taskId: string; enabled: boolean; pct: number }>(
		"propose_size_mismatch_close",
		"Stage size mismatch auto-close for a running task.",
		{
			taskId,
			enabled: boolean("Enable or disable size mismatch auto-close."),
			pct: number(
				"Required threshold percentage, 0.5 through 100, including when disabling.",
			),
		},
		["taskId", "enabled", "pct"],
		async (o, rt) =>
			proposalResult(
				await stagePosition(
					"size-mismatch-close",
					[o.taskId, o.enabled ? "on" : "off"],
					{ pct: String(o.pct) },
					rt,
				),
			),
		true,
	),
	tool<Record<string, never>>(
		"proposal_list",
		"Read local Proposal views, including their stored preflight results. Does not refresh or authorize them.",
		{},
		[],
		async (_o, rt) => ({
			proposals: (await new ProposalStore(rt.home, rt.now).list()).map(
				proposalResult,
			),
			message: "Nothing is signed or sent until a human runs `mob sign <id>`.",
		}),
	),
	tool<{ id: string }>(
		"proposal_get",
		"Read one local Proposal view with its exact message, digest, expiry, body, and stored preflight. Does not refresh or authorize it.",
		{
			id: {
				type: "string",
				pattern: "^p-[1-9][0-9]*$",
				description: "Proposal id.",
			},
		},
		["id"],
		async (o, rt) =>
			proposalResult(await new ProposalStore(rt.home, rt.now).get(o.id)),
	),
];
