// Ported from mobius@33ed2ece packages/liquidation/src/trim.ts
/**
 * Liquidation-protection trim math (Liquidation-Protection PRD).
 *
 * Protection reduces BOTH legs by the same base quantity when either comes
 * within `thresholdPct` of liquidation, until the breached leg sits at
 * `LIQ_PROTECTION_TARGET_MULT × thresholdPct`.
 *
 * This module is the single source of the numbers, because the same ones are
 * decided in three places that must agree exactly: the browser's open-time
 * block, the funding-server's trim solve, and the Manage banner's arithmetic.
 */

import { crossDistanceToLiqPct, type DnSide } from "./distance.ts";

/** Thrown by the parts of this feature that are scaffolded but not yet built.
 *  Named so a stub reached in production is unmistakable in a stack trace —
 *  never a silent zero or a plausible-looking default. */
export class NotImplementedError extends Error {
	constructor(what: string) {
		super(`${what} is not implemented yet`);
		this.name = "NotImplementedError";
	}
}

/** Where a breached leg is trimmed back to, as a multiple of the threshold. */
export const LIQ_PROTECTION_TARGET_MULT = 1.5;

/**
 * Default protection threshold, percent of mark.
 *
 * Deliberately equal in VALUE to `HEALTH_CAUTION_PCT` but NOT the same constant:
 * the health band is a display decision and this is a trading trigger. They are
 * aligned today so protection fires exactly when a health bar turns red (the
 * PRD's stated reason for the default), and they must be able to move apart
 * later without one silently dragging the other.
 */
export const LIQ_PROTECTION_DEFAULT_PCT = 8;

/** The distance a breached leg is trimmed back to. */
export function liqProtectionTargetPct(thresholdPct: number): number {
	return thresholdPct * LIQ_PROTECTION_TARGET_MULT;
}

/**
 * Fraction of a leg's base quantity to close so its distance-to-liquidation
 * moves from `currentDistPct` to `targetDistPct`. Null when unsolvable.
 *
 * ── Derivation ──
 * `crossDistanceToLiqPct` is affine in `x = equity/notional`. Inverting it:
 *
 *   short:  x = (1 + d/100)(1 + m) − 1 = (1+m)·d/100 + m
 *   long:   x = 1 − (1 − d/100)(1 − m) = (1−m)·d/100 + m
 *
 * i.e. `X(d) = k·d/100 + m` with `k = 1+m` (short) or `1−m` (long).
 *
 * A trim of fraction `f` takes notional to `N(1−f)` while leaving the equity
 * that backs the position unchanged, so `x → x/(1−f)`. Setting
 * `X(d₀)/(1−f) = X(d_t)` and solving:
 *
 *   f = k·(d_t − d₀) / (k·d_t + 100·m)
 *
 * ── Why the answer depends on mmf and side ──
 * `X` has intercept `m`, so a given distance corresponds to more equity-per-
 * notional than the distance alone implies; the ratio `X(d₀)/X(d_t)` is closer
 * to 1 than `d₀/d_t` is, and the required trim is SMALLER. `f` is therefore
 * strictly decreasing in `m`, on both sides. At `m = 0` it degenerates to the
 * naive `1 − d₀/d_t`. And since `k_short = 1+m > 1−m = k_long`, a short always
 * trims slightly more than a long at the same distances.
 *
 * For 8% → 12%: `m = 0` gives 33.3%; `m = 2%` gives 28.7%; `m = 5%` gives 23.9%
 * (short) / 23.2% (long). The PRD's "~28% trim" is only true near `m = 2%`, so
 * every user-facing percentage must be computed, never hardcoded.
 *
 * ── Isolated margin ──
 * The `x → x/(1−f)` step above assumes the backing equity survives the trim.
 * That holds for cross, and for isolated ONLY IF the released margin is added
 * back afterwards — a partial close of an isolated position releases margin
 * proportionally, leaving `x` exactly unchanged. This formula is therefore
 * correct for both modes, but isolated needs a second execution step to earn
 * it. See `TrimPolicy` in the funding-server.
 *
 * ── Unknown mmf ──
 * `null` is solved at `m = 0`. Because `f` is strictly decreasing in `m`, that
 * is the MAXIMUM over all `m ≥ 0` — it over-trims rather than under-trims,
 * which is the safe direction. This is provable, not a guess.
 */
export function trimFractionToTarget(
	currentDistPct: number,
	targetDistPct: number,
	maintenanceMarginFraction: number | null,
	side: DnSide,
): number | null {
	if (!Number.isFinite(currentDistPct) || currentDistPct < 0) return null;
	if (!Number.isFinite(targetDistPct) || targetDistPct <= 0) return null;

	const m = maintenanceMarginFraction ?? 0;
	if (!Number.isFinite(m) || m < 0 || m >= 1) return null;

	// Already at or past the target — nothing to trim. Clamped to 0 rather than
	// returned negative: a caller acting on a negative fraction would ADD to the
	// position, which is the opposite of protection.
	if (currentDistPct >= targetDistPct) return 0;

	const k = side === "short" ? 1 + m : 1 - m;
	const denom = k * targetDistPct + 100 * m;
	if (!(denom > 0)) return null;

	const f = (k * (targetDistPct - currentDistPct)) / denom;
	if (!Number.isFinite(f)) return null;

	// A trim is a partial close by definition; reaching 1 means "close it", which
	// is a different action the caller decides on its own terms.
	return Math.max(0, Math.min(f, 1));
}

/**
 * The distance a leg would sit at once `trimFractionToTarget` is applied —
 * the inverse check, used to verify a solve rather than trust it.
 *
 * Exists because the trim's whole contract is "this fraction reaches that
 * distance", and the cheapest way to keep that honest is to be able to ask.
 */
export function distanceAfterTrimPct(
	equityUsd: number,
	notionalUsd: number,
	maintenanceMarginFraction: number,
	side: DnSide,
	trimFraction: number,
): number | null {
	if (!Number.isFinite(trimFraction) || trimFraction < 0 || trimFraction >= 1) {
		return null;
	}
	return crossDistanceToLiqPct(
		equityUsd,
		notionalUsd * (1 - trimFraction),
		maintenanceMarginFraction,
		side,
	);
}

/** Largest threshold a leg at `openDistPct` can carry without firing at once. */
export function largestUsableThresholdPct(openDistPct: number): number {
	// Floored to one decimal because this number is quoted to the user verbatim
	// ("Use 5% or less"), and a threshold they cannot type is not an answer.
	// Flooring also keeps it on the safe side of the boundary after rounding.
	return Math.floor((openDistPct / LIQ_PROTECTION_TARGET_MULT) * 10) / 10;
}

/**
 * The open-time protection block (PRD "Warnings on the field").
 *
 * Blocks when a leg would OPEN closer to liquidation than the distance
 * protection would immediately trim it back to — i.e. the position would be
 * trimmed the moment it existed — and names the largest threshold that would
 * not do that, so the message is never a dead end.
 *
 * Generic over the leg key so this package stays venue-agnostic: the browser
 * passes its venue id, the server passes `"long" | "short"`.
 *
 * ── The boundary is STRICT, and that is what makes the PRD's own copy true ──
 * The PRD's prose says "at or under 1.5x the threshold" while its example
 * message says "Use 5% or less" for a leg opening 7.5% out. Those disagree: an
 * inclusive test blocks 5% too (7.5 <= 7.5), so the largest usable value would
 * be strictly below 5 and unquotable. Strict `<` blocks only a leg that is
 * genuinely inside the target, leaves 5% usable, and makes the quoted copy
 * exactly right. The boundary case it admits is a zero-width trim (`f = 0`),
 * which does nothing — so nothing is risked by admitting it.
 *
 * A null distance never blocks. It means the leg has not been read yet, and
 * refusing an open over a missing number would block on a loading spinner.
 * The worker applies the same rule at the other end: it does not trim on a
 * distance it cannot see.
 */
export interface ProtectionOpenBlock<TLeg> {
	/** The binding leg — the one closest to liquidation at open. */
	leg: TLeg;
	openDistPct: number;
	/**
	 * Where protection would trim this leg back to: `1.5 x threshold`.
	 *
	 * Returned so the message can SAY it. Without it the copy states the leg's
	 * distance beside the threshold and explains neither — a leg opening at 8.0%
	 * blocked by an 8% threshold reads as "8 is not less than 8, why?", when the
	 * real reason is the 12% it would be trimmed back to.
	 */
	targetPct: number;
	/** The largest threshold that would NOT trim this leg at open. */
	largestUsablePct: number;
	/**
	 * True when there is no threshold to quote at all: the leg opens so close to
	 * liquidation that `openDistPct / 1.5` floors to zero, leaving
	 * `largestUsablePct` a dead number rather than advice.
	 *
	 * It used to ALSO cover a `largestUsablePct` sitting at or below the leg's
	 * maintenance margin — "every threshold that fires late enough not to trim
	 * at open fires too late for the trim to fill". That rule is gone. It
	 * compared two quantities with no common reference point: a threshold is a
	 * price distance from MARK to the liquidation price, while a maintenance
	 * margin's price-axis meaning is the separate, non-overlapping segment from
	 * the LIQUIDATION PRICE to bankruptcy. Nothing derived the 1x coefficient
	 * joining them, and the message it produced ("11% is thinner than 16.7%")
	 * asserted a containment that does not exist.
	 */
	noWorkableThreshold: boolean;
}

export function protectionOpenBlock<TLeg>(
	legs: readonly {
		leg: TLeg;
		openDistPct: number | null;
	}[],
	thresholdPct: number,
): ProtectionOpenBlock<TLeg> | null {
	if (!Number.isFinite(thresholdPct) || thresholdPct <= 0) return null;
	const target = liqProtectionTargetPct(thresholdPct);

	let worst: { leg: TLeg; openDistPct: number } | null = null;
	for (const entry of legs) {
		const dist = entry.openDistPct;
		if (dist === null || !Number.isFinite(dist)) continue;
		if (!(dist < target)) continue;
		// The WORST leg is named, not the first one listed: it is the binding
		// constraint, and it is the one whose distance sets the largest usable
		// threshold.
		if (worst === null || dist < worst.openDistPct) {
			worst = { leg: entry.leg, openDistPct: dist };
		}
	}
	if (worst === null) return null;

	const largestUsablePct = largestUsableThresholdPct(worst.openDistPct);
	return {
		leg: worst.leg,
		openDistPct: worst.openDistPct,
		targetPct: target,
		largestUsablePct,
		noWorkableThreshold: largestUsablePct <= 0,
	};
}
