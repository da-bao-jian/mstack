import {
	fetchMarketMetadata,
	type ObservedFundingRate,
	type Snapshot,
} from "@mstack/funding";
import {
	buildAutoCloseTaskMessage,
	buildCloseTaskMessage,
	buildLiqProtectionMessage,
	buildNeutralizeTaskMessage,
	buildResizeTaskMessage,
	buildSizeMismatchAutoCloseMessage,
	MIN_SIZE_MISMATCH_PCT,
	MobiusClient,
	stageOpenBody,
	type WriteRoutes,
} from "@mstack/mobius-client";
import { classifyMarket } from "@mstack/opportunities";
import {
	type JsonObject,
	type Proposal,
	ProposalStore,
} from "@mstack/proposals";
import { getAddress } from "viem";
import pkg from "../package.json";
import {
	base,
	type Runtime,
	selectedVenues,
	snapshot,
} from "./commands/runtime.ts";
import { getConfig, numberFlag, readConfig, UsageError } from "./config.ts";
import { type Checked, Checks, configChecks } from "./preflight/checks.ts";
import { type ManageCommand, managePreflight } from "./preflight/manage.ts";
import { openPreflight } from "./preflight/open.ts";
import { executionVenues } from "./preflight/readiness.ts";

function nativeLeg(value: string | undefined) {
	const separator = value?.indexOf(":") ?? -1;
	if (!value || separator <= 0 || separator === value.length - 1)
		throw new UsageError("A leg must be venue:market, as printed by scan");
	const venue = value.slice(0, separator),
		market = value.slice(separator + 1);
	if (!(executionVenues as readonly string[]).includes(venue))
		throw new UsageError(`${venue} is not executable on Mobius`);
	return { venue, market };
}
function resolveRow(
	data: Snapshot,
	venue: string,
	market: string,
): ObservedFundingRate {
	const row = data.rates.find(
		(row) => row.venue === venue && row.market === market,
	);
	if (!row)
		throw new Error(
			`${venue}:${market}: missing from snapshot${data.failed.length ? `; failed: ${JSON.stringify(data.failed)}` : ""}`,
		);
	return row;
}
function passed(result: Checked): void {
	if (!result.ok) {
		const fail = result.checks.find((c) => !c.ok);
		throw new Error(`${fail?.name ?? fail?.route}: ${fail?.error}`);
	}
}
function onOff(value: string | undefined): boolean {
	if (value !== "on" && value !== "off")
		throw new UsageError("Expected on or off");
	return value === "on";
}
function percent(value: string, name: string, minimum: number) {
	const n = numberFlag(value, name, minimum);
	if (n > 100) throw new UsageError(`${name} must be <= 100`);
	return n;
}

export async function stagePosition(
	command: string,
	args: string[],
	values: Record<string, string | boolean | undefined>,
	rt: Runtime,
): Promise<Proposal> {
	const text = (key: string) => values[key] as string | undefined;
	const config = await readConfig(rt.home);
	await configChecks(config, new Checks(rt.now));
	const client = new MobiusClient({
		base: String(getConfig(config, "api_base")),
		version: pkg.version,
		fetch: rt.fetch,
	});
	const metadata = (venue: string, market: string) =>
		fetchMarketMetadata(venue, market, {
			fetch: rt.fetch,
			now: rt.now,
			signal: AbortSignal.timeout(30_000),
			reportFailure: (f) => {
				throw new Error(f.error);
			},
		});
	let body: JsonObject;
	let message: string;
	let route: keyof WriteRoutes;
	let preflight: Checked;
	let purpose: string;
	if (command === "open") {
		if (args.length !== 1)
			throw new UsageError(
				"Usage: mob open <BASE> --long venue:market --short venue:market --size usd",
			);
		const ticker = base(args[0]);
		const long = nativeLeg(text("long")),
			short = nativeLeg(text("short"));
		if (long.venue === short.venue)
			throw new UsageError("Open requires two different venues");
		for (const leg of [long, short]) {
			const classified = classifyMarket(leg.venue, leg.market);
			if (!classified || classified.base !== ticker)
				throw new UsageError(
					`${leg.venue}:${leg.market} does not match base ${ticker}`,
				);
		}
		const size = numberFlag(text("size") ?? "", "size", Number.MIN_VALUE);
		const spread = numberFlag(
			text("max-spread-bps") ?? "50",
			"max-spread-bps",
			Number.MIN_VALUE,
		);
		const protect =
			text("protect") === undefined || text("protect") === "off"
				? undefined
				: percent(text("protect") as string, "protect", Number.MIN_VALUE);
		let leverage: [number, number] | undefined;
		if (text("assume-leverage") !== undefined) {
			const parts = (text("assume-leverage") as string).split(",");
			if (parts.length < 1 || parts.length > 2)
				throw new UsageError("assume-leverage requires L[,S]");
			const l = numberFlag(parts[0], "assume-leverage", 1),
				s = numberFlag(parts[1] ?? parts[0], "assume-leverage", 1);
			leverage = [l, s];
		}
		const data = await snapshot(selectedVenues([long.venue, short.venue]), rt);
		const l = resolveRow(data, long.venue, long.market),
			s = resolveRow(data, short.venue, short.market);
		preflight = await openPreflight(
			{
				config,
				long: l,
				short: s,
				sizeUsd: size,
				maxSpreadBps: spread,
				protect,
				assumedLeverage: leverage,
			},
			{ read: client.read.bind(client), metadata },
			rt.now,
		);
		passed(preflight);
		const staged = stageOpenBody(
			{
				longVenue: long.venue,
				longMarket: long.market,
				shortVenue: short.venue,
				shortMarket: short.market,
				sizeUsd: size,
				longPrice: l.markPrice as number,
				shortPrice: s.markPrice as number,
				minFundingApy: numberFlag(text("min-apy") ?? "0", "min-apy", 0),
				maxSpreadBps: spread,
				...(text("auto-close") === undefined
					? {}
					: { autoClose: onOff(text("auto-close")) }),
				...(protect === undefined ? {} : { liqProtectionPct: protect }),
				...(text("size-mismatch") === undefined
					? {}
					: {
							sizeMismatchPct: percent(
								text("size-mismatch") as string,
								"size-mismatch",
								MIN_SIZE_MISMATCH_PCT,
							),
						}),
			},
			rt.now(),
		);
		body = staged.body;
		message = staged.message;
		route = "/api/arbitrage/create";
		purpose = `Open ${ticker}: long ${text("long")}, short ${text("short")}, $${size} per leg`;
	} else {
		const setting = ["protect", "auto-close", "size-mismatch-close"].includes(
			command,
		);
		if (args.length !== (setting ? 2 : 1) || !args[0])
			throw new UsageError(
				`Usage: mob ${command} <task>${setting ? " <setting>" : ""}`,
			);
		const targets = {
			...(text("long") === undefined
				? {}
				: {
						long: numberFlag(text("long") as string, "long", Number.MIN_VALUE),
					}),
			...(text("short") === undefined
				? {}
				: {
						short: numberFlag(
							text("short") as string,
							"short",
							Number.MIN_VALUE,
						),
					}),
		};
		const snapshots = new Map<string, Promise<Snapshot>>();
		preflight = await managePreflight(
			command as ManageCommand,
			args[0],
			config,
			targets,
			{
				read: client.read.bind(client),
				market: async (venue, market) => {
					let data = snapshots.get(venue);
					if (!data) {
						data = snapshot(selectedVenues([venue]), rt);
						snapshots.set(venue, data);
					}
					return {
						row: resolveRow(await data, venue, market),
						metadata: await metadata(venue, market),
					};
				},
			},
			rt.now,
		);
		passed(preflight);
		const auth = { taskId: args[0], timestamp: Math.floor(rt.now() / 1000) };
		if (command === "close") {
			body = auth;
			message = buildCloseTaskMessage(auth);
			route = "/api/arbitrage/close";
		} else if (command === "neutralize") {
			body = auth;
			message = buildNeutralizeTaskMessage(auth);
			route = "/api/arbitrage/neutralize";
		} else if (command === "resize") {
			const quantities = (
				preflight as Awaited<ReturnType<typeof managePreflight>>
			).quantized;
			const b = { ...auth, ...quantities };
			body = b;
			message = buildResizeTaskMessage(b);
			route = "/api/arbitrage/resize";
		} else if (command === "protect") {
			const b = {
				...auth,
				liqProtectionPct:
					args[1] === "off"
						? null
						: percent(args[1], "protect", Number.MIN_VALUE),
			};
			body = b;
			message = buildLiqProtectionMessage(b);
			route = "/api/arbitrage/liq-protection";
		} else if (command === "auto-close") {
			const b = {
				...auth,
				autoClose: onOff(args[1]),
				minFundingApy: numberFlag(text("min-apy") ?? "0", "min-apy", 0),
			};
			body = b;
			message = buildAutoCloseTaskMessage(b);
			route = "/api/arbitrage/auto-close";
		} else {
			const enabled = onOff(args[1]);
			const pct = percent(text("pct") ?? "", "pct", MIN_SIZE_MISMATCH_PCT);
			const b = { ...auth, enabled, thresholdPct: enabled ? pct : 0 };
			body = b;
			message = buildSizeMismatchAutoCloseMessage(b);
			route = "/api/arbitrage/size-mismatch-auto-close";
		}
		purpose = `${command} task ${args[0]}. Request is replayable inside the server's 300 s window (no nonce); this Proposal expires at 300 s and can be signed once.`;
	}
	rt.signal?.throwIfAborted();
	const store = new ProposalStore(rt.home, rt.now);
	const staged = await store.stage({
		kind: "sign-text",
		owner: getAddress(config.owner as string),
		purpose,
		signing: { type: "text", message },
		submit: { base: client.base, route, body, signatureField: "signature" },
		preflightPlan: { checks: preflight.plan },
	});
	const preview = await store.preview(staged.id, async () => ({
		ok: preflight.ok,
		checks: preflight.checks,
		checkedAt: rt.now(),
	}));
	return preview;
}
