// Ported from mobius@33ed2ece packages/liquidation/src/distance.ts
/**
 * Distance-to-liquidation math, shared by the browser and the funding-server.
 *
 * Every function here was RELOCATED verbatim from
 * `frontend/src/features/delta-neutral/lib/deltaNeutralMath.ts` — same bodies,
 * same docstrings, same units. Nothing was rewritten in the move, and
 * `deltaNeutralMath.ts` re-exports all of it, so the frontend's existing test
 * file passing unchanged is the proof the relocation preserved behaviour.
 *
 * It lives in a package rather than being duplicated because the same numbers
 * are now decided in three places that must agree exactly: the open-time
 * protection block in the browser, the funding-server's trim solve, and the
 * Manage banner's arithmetic. A copy per consumer is how those drift, and this
 * codebase has already had to retract one such claim in writing — see the
 * `defaultMaxImpactBps` docstring, which walks back a false "mirror of the
 * server" comment.
 *
 * Units, throughout: distances are PERCENT (0–100, not 0–1); maintenance-margin
 * fractions are decimals (0.05 = 5%); money is USD.
 */

/** Which way a leg liquidates. A short dies on the way up, a long on the way
 *  down, and the two are not mirror images — the maintenance requirement
 *  tracks the notional, which moves with the price. */
export type DnSide = "long" | "short";

/** How a leg's margin is held. The two are NOT interchangeable for protection:
 *  see `@mobius/liquidation`'s trim module for why a partial close moves the
 *  distance under cross and cannot under isolated. */
export type MarginMode = "cross" | "isolated";

// ─── Tunables (PRD §10 — reasonable starting values, tune against real positions) ──
export const HEALTH_HEALTHY_PCT = 20;
export const HEALTH_CAUTION_PCT = 8;

// ─────────────────────────────── Health bands (§6) ────────────────────────────

export type DnHealthTone = "healthy" | "caution" | "danger";

export function healthTone(distToLiqPct: number): DnHealthTone {
	if (distToLiqPct >= HEALTH_HEALTHY_PCT) return "healthy";
	if (distToLiqPct >= HEALTH_CAUTION_PCT) return "caution";
	return "danger";
}

/** Bar fill fraction 0..1; full at 50% distance (the prototype's bar scale). */
export function healthBarFraction(distToLiqPct: number): number {
	const full = 50;
	return Math.max(0, Math.min(1, distToLiqPct / full));
}

/**
 * Distance-to-liquidation as a percentage of mark (PRD §6 — the only measure
 * that means the same thing on both venues). Uses the venue's own liq price.
 */
export function distanceToLiqPct(
	markPrice: number,
	liquidationPrice: number | null,
): number | null {
	if (
		liquidationPrice === null ||
		!Number.isFinite(liquidationPrice) ||
		liquidationPrice <= 0 ||
		!Number.isFinite(markPrice) ||
		markPrice <= 0
	) {
		return null;
	}
	return (Math.abs(markPrice - liquidationPrice) / markPrice) * 100;
}

/**
 * Distance-to-liquidation for a cross-margin position computed from account
 * equity, when the venue does not report a per-position liquidation price
 * (Lighter returns `liquidation_price = 0` for well-collateralized cross
 * positions).
 *
 * This returns the SAME quantity `distanceToLiqPct` does — how far the mark can
 * move, as a percent of mark — so the two legs of a pair can be compared and
 * equalized. Deriving `equity/notional − mmf` instead (the margin-ratio
 * headroom) silently mixes two different measures: at equity/notional = 1 and
 * mmf = 5% the ratio reads 95% while the price can really only move 90.5%, and
 * the rebalance then equalizes numbers that do not mean the same thing.
 *
 * Liquidation is when equity reaches the maintenance requirement `notional ×
 * mmf` at the liquidation price. With `x = equity/notional`, solving for the
 * mark move gives, per side:
 *
 *   short:  (x + 1) / (1 + mmf) − 1        (liquidates on the way UP)
 *   long:   1 − (1 − x) / (1 − mmf)        (liquidates on the way DOWN)
 *
 * The two differ because the notional — and so the maintenance requirement —
 * moves WITH the price. A long with `x ≥ 1` cannot be liquidated at all; the
 * formula extrapolates past 100% there rather than clamping, because the
 * rebalance needs a monotonic, invertible measure to solve against.
 *
 * Advisory — it assumes this position dominates the account's maintenance
 * margin (true for a single-leg DN account).
 */
export function crossDistanceToLiqPct(
	accountEquityUsd: number,
	positionNotionalUsd: number,
	maintenanceMarginFraction: number,
	side: DnSide,
): number | null {
	if (
		!Number.isFinite(accountEquityUsd) ||
		!Number.isFinite(positionNotionalUsd) ||
		positionNotionalUsd <= 0 ||
		!Number.isFinite(maintenanceMarginFraction) ||
		maintenanceMarginFraction < 0 ||
		maintenanceMarginFraction >= 1
	) {
		return null;
	}
	const x = accountEquityUsd / positionNotionalUsd;
	const m = maintenanceMarginFraction;
	const pct =
		side === "short" ? ((x + 1) / (1 + m) - 1) * 100 : (1 - (1 - x) / (1 - m)) * 100;
	return Math.max(0, pct);
}

// ─────────────────────────────── Rebalance slope (§7, flat slope) ─────────────

/**
 * Distance moves this many pp per $ of margin added (flat slope, PRD §10).
 *
 * The slope is the derivative of `crossDistanceToLiqPct` in equity, so it has
 * to carry the same per-side denominator — otherwise the projection and the
 * proposal drift from the measure they claim to move.
 */
export function distSlopePerUsd(
	notionalUsd: number,
	maintenanceMarginFraction: number,
	side: DnSide,
): number {
	if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) return 0;
	if (
		!Number.isFinite(maintenanceMarginFraction) ||
		maintenanceMarginFraction < 0 ||
		maintenanceMarginFraction >= 1
	) {
		return 0;
	}
	const denom = side === "short" ? 1 + maintenanceMarginFraction : 1 - maintenanceMarginFraction;
	return 100 / (notionalUsd * denom);
}

// ─────────────────────── Pre-trade liquidation estimate (§3 Details) ──────────

/**
 * Hyperliquid's maintenance margin is half the initial margin at the market's
 * max leverage, so `mmf = 1 / (2 · maxLeverage)`. Lighter publishes its own
 * `maintenance_margin_fraction` per market and needs no derivation.
 */
export function hlMaintenanceMarginFraction(maxLeverage: number | null): number | null {
	if (maxLeverage === null || !Number.isFinite(maxLeverage) || maxLeverage <= 0) {
		return null;
	}
	return 1 / (2 * maxLeverage);
}

/**
 * Estimated liquidation price for a CROSS-margin leg, where the whole venue
 * balance backs the position — not just the margin this order posts.
 *
 * `estimateLiquidationPrice` below answers the isolated question (`1/leverage −
 * mmf`), which is the right formula only when the position can be liquidated on
 * its own. Applying it to a cross leg understates the distance badly: a $400
 * position at 5× on an account holding $2,000 is nowhere near the isolated
 * estimate, and a long whose equity exceeds its notional cannot be liquidated
 * at any price. Showing the isolated number there is not conservative, it is
 * wrong, and it makes a safe position look close to death.
 *
 * Returns null when the inputs are unusable OR when no positive liquidation
 * price exists — the caller can tell the two apart, since it supplied the
 * inputs. Advisory: it assumes this position dominates the account's
 * maintenance margin, so an account already carrying other positions is
 * flattered.
 */
export function estimateCrossLiquidationPrice(
	markPrice: number,
	accountEquityUsd: number,
	positionNotionalUsd: number,
	maintenanceMarginFraction: number,
	side: DnSide,
): number | null {
	if (!Number.isFinite(markPrice) || markPrice <= 0) return null;
	const distPct = crossDistanceToLiqPct(
		accountEquityUsd,
		positionNotionalUsd,
		maintenanceMarginFraction,
		side,
	);
	if (distPct === null) return null;
	const px =
		side === "long" ? markPrice * (1 - distPct / 100) : markPrice * (1 + distPct / 100);
	return px > 0 ? px : null;
}

export function estimateLiquidationPrice(
	markPrice: number,
	leverage: number,
	maintenanceMarginFraction: number,
	side: DnSide,
): number | null {
	if (
		!Number.isFinite(markPrice) ||
		markPrice <= 0 ||
		!Number.isFinite(leverage) ||
		leverage <= 0 ||
		!Number.isFinite(maintenanceMarginFraction) ||
		maintenanceMarginFraction < 0
	) {
		return null;
	}
	const move = 1 / leverage - maintenanceMarginFraction;
	if (!(move > 0)) return null;
	return side === "long" ? markPrice * (1 - move) : markPrice * (1 + move);
}
