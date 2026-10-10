import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation/types.js";
import { config } from "./commands/config.ts";
import { explain } from "./commands/explain.ts";
import { type HistoryOptions, history } from "./commands/history.ts";
import { type RatesOptions, rates } from "./commands/rates.ts";
import type { Runtime } from "./commands/runtime.ts";
import { type ScanOptions, scan } from "./commands/scan.ts";
import { type StatusOptions, status } from "./commands/status.ts";
import { UsageError } from "./config.ts";

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
		description: `${description} ${readOnly}`,
		inputSchema,
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
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
		"Read a local setting: api_base, owner, default_size_usd, taker_fee_bps.<venue>, or builder_fee_tenths_bps. No setting is changed.",
		{ key: text("Config key to read.") },
		["key"],
		({ key }, rt) => config({ action: "get", key }, rt),
	),
];
