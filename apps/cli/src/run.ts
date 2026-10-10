import { type ParseArgsConfig, parseArgs } from "node:util";
import {
	aster,
	binance,
	bybit,
	type Fetch,
	type FundingHistory,
	fetchFundingHistory,
	fetchSnapshot,
	hyperliquid,
	lighter,
	lighterMainnet,
	okx,
	type Snapshot,
	type VenueAdapter,
} from "@mobstack/funding";
import { classifyMarket, rankOpportunities } from "@mobstack/opportunities";
import pkg from "../package.json";
import {
	apiBase,
	configHome,
	getConfig,
	numberFlag,
	ownerAddress,
	readConfig,
	setConfig,
	UsageError,
} from "./config.ts";
import { explain } from "./knowledge.ts";
import { footer, pct, renderScan, scanView, table } from "./render.ts";
import { fetchStatus, renderStatus, statusFooter } from "./status.ts";
import { installationRoot, upgrade } from "./upgrade.ts";

const adapters = [
	hyperliquid,
	lighter,
	lighterMainnet,
	aster,
	binance,
	bybit,
	okx,
];
const help = `mob ${pkg.version} — public funding and Mobius task reads

Usage:
  mob scan [--size N=1000] [--market BASE] [--venues a,b] [--top N=10]
           [--all-pairs] [--executable] [--min-apy PCT] [--strict] [--json]
           [--min-volume N=1000000] [--include-thin] [--hold-days N=7] [--top-exec N=5]
  mob rates [--venue V] [--market BASE] [--strict] [--json]
  mob history <BASE> [--days N=7] [--venues a,b] [--strict] [--json]
  mob explain [topic] [--simple]
  mob status [--owner 0x…] [--task ID] [--trims] [--resizes] [--api-base URL] [--json]
  mob config get <key>
  mob config set <key> <value>
  mob upgrade
  mob --version
  mob --help

Venues: hl,lighter,lighter-mainnet,aster,binance,bybit,okx
Config keys: api_base, owner, default_size_usd, taker_fee_bps.<venue>, builder_fee_tenths_bps
Fee defaults are estimates. Annualized rates are simple, not compounded.
Exit: 0 success, 1 usage/request error, 2 no venue rates, 3 partial failure with --strict.`;

const flag = (type: "string" | "boolean") => ({ type });
const common = {
	json: flag("boolean"),
	strict: flag("boolean"),
	help: flag("boolean"),
};
const definitions: Record<string, ParseArgsConfig["options"]> = {
	scan: {
		...common,
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
};

export interface Runtime {
	fetch: Fetch;
	now: () => number;
	home: string;
	out: (text: string) => void;
	err: (text: string) => void;
}

function selectedVenues(value?: string): VenueAdapter[] {
	if (value === undefined) return adapters;
	const names = value.split(",");
	if (
		names.some((name) => !adapters.some((adapter) => adapter.venue === name)) ||
		new Set(names).size !== names.length
	)
		throw new UsageError(`Invalid venues: ${value}`);
	return names.map(
		(name) =>
			adapters.find((adapter) => adapter.venue === name) as VenueAdapter,
	);
}

function base(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(value))
		throw new UsageError("market must be a base ticker");
	return value.toUpperCase();
}

function exitFor(
	snapshot: Snapshot,
	strict: boolean,
	extraFailures = 0,
): number {
	if (!snapshot.rates.length) return 2;
	return strict && snapshot.failed.length + extraFailures > 0 ? 3 : 0;
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

async function historyCommand(
	snapshot: Snapshot,
	venues: VenueAdapter[],
	market: string,
	days: number,
	rt: Runtime,
) {
	const endTime = rt.now();
	const startTime = Math.floor(endTime - days * 86_400_000);
	if (startTime <= 0)
		throw new UsageError("History window starts before Unix time");
	const unmatched = snapshot.rates.filter(
		(row) => classifyMarket(row.venue, row.market) === null,
	);
	const matches = snapshot.rates.filter((row) => {
		const item = classifyMarket(row.venue, row.market);
		return (
			item?.base.toUpperCase() === market && item.quoteClass === "usd-stable"
		);
	});
	const unsupported = venues
		.filter((v) => v.venue.startsWith("lighter"))
		.map((v) => ({ venue: v.venue, reason: "no keyless history" }));
	const missing = venues
		.filter(
			(v) =>
				!v.venue.startsWith("lighter") &&
				!matches.some((r) => r.venue === v.venue),
		)
		.map((v) => ({
			venue: v.venue,
			reason: `no usd-stable listing for ${market} in snapshot`,
		}));
	const failed: { venue: string; market?: string; error: string }[] = [
		...snapshot.failed,
	];
	const history: FundingHistory[] = [];
	// Sequential per market keeps public history reads within venue rate limits.
	for (const row of matches) {
		if (row.venue.startsWith("lighter")) continue;
		try {
			history.push(
				await fetchFundingHistory(row.venue, row.market, {
					startTime,
					endTime,
					fetch: rt.fetch,
					now: rt.now,
				}),
			);
		} catch (error) {
			failed.push({
				venue: row.venue,
				market: row.market,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	let bestPair: {
		long: string;
		short: string;
		spreadRate1hPct: number;
		spreadAnnualizedPct: number;
	} | null = null;
	for (const long of history)
		for (const short of history) {
			if (
				long.venue === short.venue ||
				long.averageRatePerHour === null ||
				short.averageRatePerHour === null
			)
				continue;
			const spreadRate1hPct =
				(short.averageRatePerHour - long.averageRatePerHour) * 100;
			if (
				spreadRate1hPct > 0 &&
				(!bestPair || spreadRate1hPct > bestPair.spreadRate1hPct)
			)
				bestPair = {
					long: `${long.venue}:${long.market}`,
					short: `${short.venue}:${short.market}`,
					spreadRate1hPct,
					spreadAnnualizedPct: spreadRate1hPct * 8760,
				};
		}
	const data = {
		base: market,
		startTime,
		endTime,
		history,
		bestPair,
		unsupported,
		missing,
		failed,
		unmatched: unmatched.map(({ venue, market }) => ({ venue, market })),
		observedAt: snapshot.observedAt,
		source: snapshot.source,
		annualizationMethod: "simple",
	};
	const human = [
		table(
			[
				"venue:market",
				"samples",
				"hours",
				"avg/hour",
				"annualized",
				"min/hour",
				"max/hour",
			],
			history.map((r) => [
				`${r.venue}:${r.market}`,
				r.sampleCount,
				r.hoursCovered.toFixed(2),
				pct(
					r.averageRatePerHour === null ? null : r.averageRatePerHour * 100,
					6,
				),
				pct(r.annualizedPct, 2),
				pct(r.minRatePerHour === null ? null : r.minRatePerHour * 100, 6),
				pct(r.maxRatePerHour === null ? null : r.maxRatePerHour * 100, 6),
			]),
		),
		...[...unsupported, ...missing].map((r) => `${r.venue}: ${r.reason}`),
		bestPair
			? `Best average spread: long ${bestPair.long} / short ${bestPair.short}: ${pct(bestPair.spreadRate1hPct, 6)}/hour, ${pct(bestPair.spreadAnnualizedPct, 2)}/year (gross; coverage can differ)`
			: "Best average spread: unavailable",
	].join("\n");
	return {
		data,
		human,
		ending: footer(
			{
				...snapshot,
				failed: failed.map((f) => ({
					venue: f.market ? `${f.venue}:${f.market}` : f.venue,
					error: f.error,
				})),
			},
			unmatched.length,
			rt.now(),
		),
	};
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
		const json = values.json === true;
		const strict = values.strict === true;
		if (command === "upgrade") {
			if (positionals.length)
				throw new UsageError("upgrade does not accept positional arguments");
			rt.out(await upgrade(await installationRoot()));
			return 0;
		}
		if (command === "explain") {
			if (positionals.length > 1)
				throw new UsageError("explain accepts at most one topic");
			rt.out(explain(positionals[0], values.simple === true));
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
					action === "get"
						? getConfig(await readConfig(rt.home), key)
						: await setConfig(key, value, rt.home),
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
		const config = await readConfig(rt.home);
		if (command === "status") {
			const configuredOwner = text("owner") ?? config.owner;
			if (!configuredOwner)
				throw new UsageError(
					"status requires --owner or config key owner (mob config set owner 0x…)",
				);
			const owner = ownerAddress(configuredOwner);
			const statusApi = apiBase(
				text("api-base") ?? String(getConfig(config, "api_base")),
			);
			const task = text("task");
			if (task !== undefined && task.trim() === "")
				throw new UsageError("task must be nonempty");
			if ((values.trims || values.resizes) && !task)
				throw new UsageError("--trims and --resizes require --task");
			const result = await fetchStatus({
				owner,
				task,
				trims: values.trims === true,
				resizes: values.resizes === true,
				apiBase: statusApi,
				version: pkg.version,
				fetch: rt.fetch,
				now: rt.now,
			});
			display(
				rt,
				result,
				renderStatus(result),
				statusFooter(result, statusApi, rt.now()),
				json,
			);
			return 0;
		}
		const venues = selectedVenues(
			text(command === "rates" ? "venue" : "venues"),
		);
		const market = base(
			command === "history" ? positionals[0] : text("market"),
		);
		const days = numberFlag(text("days") ?? "7", "days", Number.MIN_VALUE);
		const size = numberFlag(
			text("size") ?? Number(getConfig(config, "default_size_usd")),
			"size",
			Number.MIN_VALUE,
		);
		const top = numberFlag(text("top") ?? "10", "top", 1, true);
		const topExec = numberFlag(text("top-exec") ?? "5", "top-exec", 1, true);
		const holdDays = numberFlag(
			text("hold-days") ?? "7",
			"hold-days",
			Number.MIN_VALUE,
		);
		const minVolume = numberFlag(
			text("min-volume") ?? "1000000",
			"min-volume",
			0,
		);
		const minApy =
			text("min-apy") === undefined
				? undefined
				: numberFlag(text("min-apy") as string, "min-apy", -Number.MAX_VALUE);
		const snapshot = await fetchSnapshot(venues, {
			timeoutMs: 30_000,
			fetch: rt.fetch,
			now: rt.now,
		});
		if (command === "scan") {
			const result = rankOpportunities(snapshot, {
				sizeUsd: size,
				holdDays,
				minVolume24hUsd: minVolume,
				takerFeeBps: config.taker_fee_bps,
				builderFeeTenthsBps: Number(
					getConfig(config, "builder_fee_tenths_bps"),
				),
			});
			const { view, thinHidden } = scanView(result, {
				market,
				top,
				topExec,
				allPairs: values["all-pairs"] === true,
				executable: values.executable === true,
				minApy,
				includeThin: values["include-thin"] === true,
			});
			display(
				rt,
				{ ...result, view, thinHidden },
				renderScan(view, values.executable === true, holdDays),
				`${footer(snapshot, result.unmatched.length, rt.now())} | thin hidden: ${thinHidden}`,
				json,
			);
		} else if (command === "rates") {
			const unmatched = snapshot.rates
				.filter((r) => classifyMarket(r.venue, r.market) === null)
				.map(({ venue, market }) => ({ venue, market }));
			const view = snapshot.rates
				.filter(
					(r) =>
						!market ||
						classifyMarket(r.venue, r.market)?.base.toUpperCase() === market,
				)
				.map((r) => ({
					...r,
					ratePerHour: r.ratePerInterval / r.intervalHours,
				}));
			display(
				rt,
				{ ...snapshot, unmatched, view },
				table(
					["venue:market", "interval h", "rate/hour", "annualized", "mark"],
					view.map((r) => [
						`${r.venue}:${r.market}`,
						r.intervalHours,
						pct(r.ratePerHour * 100, 6),
						pct(r.annualizedPct, 2),
						r.markPrice,
					]),
				),
				footer(snapshot, unmatched.length, rt.now()),
				json,
			);
		} else {
			const result = await historyCommand(
				snapshot,
				venues,
				market as string,
				days,
				rt,
			);
			display(rt, result.data, result.human, result.ending, json);
			return exitFor(
				snapshot,
				strict,
				result.data.failed.length - snapshot.failed.length,
			);
		}
		return exitFor(snapshot, strict);
	} catch (error) {
		rt.err(`mob: ${error instanceof Error ? error.message : String(error)}`);
		return 1;
	}
}
