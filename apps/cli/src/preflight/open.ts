import type { MarketMetadata, ObservedFundingRate } from "@mstack/funding";
import {
	distanceToLiqPct,
	estimateLiquidationPrice,
	protectionOpenBlock,
} from "@mstack/liquidation";
import type { ArbitrageVenue } from "@mstack/mobius-client";
import type { Config } from "../config.ts";
import {
	CheckFailure,
	Checks,
	configChecks,
	type Reader,
	requireValue,
} from "./checks.ts";
import { checkReadiness } from "./readiness.ts";
import { quantizeBaseDown, quantizeBaseUp } from "./resizePlan.ts";

export function quantizeLot(
	base: number,
	meta: Pick<MarketMetadata, "lotSize" | "sizeDecimals">,
	up = false,
): number {
	if (meta.lotSize === 10 ** -meta.sizeDecimals)
		return (up ? quantizeBaseUp : quantizeBaseDown)(base, meta.sizeDecimals);
	return Number(
		(
			(up
				? Math.ceil(base / meta.lotSize - 1e-9)
				: Math.floor(base / meta.lotSize + 1e-9)) * meta.lotSize
		).toFixed(meta.sizeDecimals),
	);
}
export interface OpenInput {
	config: Config;
	long: ObservedFundingRate;
	short: ObservedFundingRate;
	sizeUsd: number;
	maxSpreadBps: number;
	protect?: number;
	assumedLeverage?: [number, number];
}
export interface OpenReads extends Reader {
	metadata: (venue: string, market: string) => Promise<MarketMetadata>;
}

/** Pure over supplied config, snapshot rows, clock and read functions. No disk or signing. */
export async function openPreflight(
	input: OpenInput,
	reads: OpenReads,
	now = Date.now,
) {
	const checks = new Checks(now);
	const quantities: Partial<Record<"long" | "short", number>> = {};
	try {
		await configChecks(input.config, checks);
		for (const venue of new Set([input.long.venue, input.short.venue]))
			await checkReadiness(
				venue as ArbitrageVenue,
				input.config.owner as string,
				reads,
				checks,
			);
		await checks.fact("open-interest", () => {
			for (const leg of [input.long, input.short])
				if (leg.venue === "hl")
					requireValue(
						leg.oiCapped === false,
						`${leg.venue}:${leg.market}: ${leg.oiCapped ? "open-interest cap reached" : "open-interest cap unreadable"}`,
					);
			return "HL legs are below their open-interest cap";
		});
		await checks.fact("marks", () => {
			for (const leg of [input.long, input.short])
				requireValue(
					typeof leg.markPrice === "number" &&
						Number.isFinite(leg.markPrice) &&
						leg.markPrice > 0,
					`${leg.venue}:${leg.market}: mark is unavailable`,
				);
			return `Staged marks: long=${input.long.markPrice}, short=${input.short.markPrice}`;
		});
		const metadata = {} as Record<"long" | "short", MarketMetadata>;
		for (const side of ["long", "short"] as const)
			await checks.fact(`metadata.${side}`, async () => {
				const leg = input[side];
				metadata[side] = await reads.metadata(leg.venue, leg.market);
				return JSON.stringify(metadata[side]);
			});
		await checks.fact("size", () => {
			requireValue(
				Number.isFinite(input.sizeUsd) && input.sizeUsd > 0,
				"size must be positive",
			);
			const coarse =
				metadata.long.lotSize >= metadata.short.lotSize
					? metadata.long
					: metadata.short;
			for (const side of ["long", "short"] as const) {
				const mark = input[side].markPrice as number;
				const meta = metadata[side];
				const quantity = quantizeLot(input.sizeUsd / mark, coarse);
				quantities[side] = quantity;
				requireValue(
					quantity > 0 && quantity + 1e-12 >= meta.minBase,
					`${side}: quantized base ${quantity} is below venue floor ${meta.minBase}`,
				);
				requireValue(
					Math.abs(quantizeLot(quantity, meta) - quantity) < 1e-12,
					`${side}: coarser lot does not align with venue lot ${meta.lotSize}`,
				);
				requireValue(
					quantity * mark + 1e-9 >= meta.minNotionalUsd,
					`${side}: quantized notional ${quantity * mark} is below venue floor ${meta.minNotionalUsd}`,
				);
			}
			return `Quantized base: long=${quantities.long}, short=${quantities.short}; coarser lot=${coarse.lotSize}`;
		});
		await checks.fact("entry-spread", () => {
			const l = input.long.markPrice as number,
				s = input.short.markPrice as number;
			const spread = (Math.abs(l - s) / ((l + s) / 2)) * 10_000;
			requireValue(
				Number.isFinite(input.maxSpreadBps) && input.maxSpreadBps >= 0,
				"max-spread-bps must be nonnegative",
			);
			requireValue(
				spread <= input.maxSpreadBps,
				`entry spread ${spread} bps exceeds cap ${input.maxSpreadBps} bps`,
			);
			return `${spread} bps <= ${input.maxSpreadBps} bps`;
		});
		await checks.fact("protection", () => {
			if (input.protect === undefined) return "Protection off";
			requireValue(
				Number.isFinite(input.protect) &&
					input.protect > 0 &&
					input.protect <= 100,
				"protect must be in (0,100]",
			);
			requireValue(
				input.assumedLeverage,
				"--protect requires --assume-leverage L[,S]",
			);
			const legs = (["long", "short"] as const).map((side, index) => {
				const leverage = input.assumedLeverage?.[index] as number;
				const meta = metadata[side];
				requireValue(
					Number.isFinite(leverage) && leverage >= 1,
					`${side}: assumed leverage must be >= 1`,
				);
				requireValue(
					meta.maxLeverage !== undefined && leverage <= meta.maxLeverage,
					`${side}: assumed leverage exceeds or cannot verify venue maximum`,
				);
				requireValue(
					meta.maintenanceMarginFraction !== undefined,
					`${side}: maintenance margin unavailable; protection cannot be estimated`,
				);
				const mark = input[side].markPrice as number;
				const distance = distanceToLiqPct(
					mark,
					estimateLiquidationPrice(
						mark,
						leverage,
						meta.maintenanceMarginFraction,
						side,
					),
				);
				requireValue(
					distance !== null,
					`${side}: opening liquidation distance cannot be estimated`,
				);
				return { leg: side, openDistPct: distance };
			});
			const block = protectionOpenBlock(legs, input.protect);
			requireValue(
				!block,
				`${block?.leg}: opening distance ${block?.openDistPct}% is below target ${block?.targetPct}%; use ${block?.largestUsablePct}% or less, or turn protection off`,
			);
			return `assumed leverage, not verified on the venue: long=${input.assumedLeverage[0]}, short=${input.assumedLeverage[1]}; estimated distances ${JSON.stringify(legs)}; assumes position margin only, excludes other account positions`;
		});
	} catch (error) {
		if (!(error instanceof CheckFailure)) throw error;
	}
	return { ...checks.result(), quantizedBase: quantities };
}
