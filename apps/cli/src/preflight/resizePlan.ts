// Ported from mobius@33ed2ece frontend/src/features/delta-neutral/lib/resizePlan.ts
/**
 * The resize form's math. Pure — no React, no network, no clock.
 *
 * Two jobs, both of which exist so the user is told the answer BEFORE they are
 * asked to sign:
 *
 *  1. Keep the USD and base-quantity boxes in step. The user names a target and
 *     may name it in either unit; the other is derived from the leg's mark.
 *  2. Mirror the server's refusals. `funding-server/src/arbitrage/resize.ts`
 *     rejects a target that quantizes to no change, an order under a venue
 *     minimum, or a reduce that would leave an uncloseable stub — and its
 *     rejection arrives ~5 seconds after a wallet signature, as a diagnostic on
 *     the task. Checking the same rules here turns that into an inline message
 *     on a form that has not been submitted yet.
 *
 * This mirror is DELIBERATELY not authoritative. The server re-derives
 * everything from a fresh venue read at execution time, because these numbers
 * come from a poll that is seconds old and the position may have moved. What is
 * here catches the cases that were already wrong when the user typed them.
 */

/**
 * Hyperliquid's minimum order value, in USD.
 *
 * Hardcoded because it is not discoverable: `meta`, `metaAndAssetCtxs` and the
 * builder-dex variants expose `szDecimals`, `maxLeverage` and `marginMode` and
 * no minimum of any kind. The only machine-readable source is the rejection
 * itself. Mirrors the funding-server constant of the same name.
 */
export const HL_MIN_ORDER_VALUE_USD = 10;

/** One leg, as the resize form sees it. */
export interface ResizeLegInput {
	side: "long" | "short";
	/** Base quantity the leg currently holds. Null when it has not been read. */
	currentBase: number | null;
	/** Venue mark, for the USD <-> base conversion. Null when unread. */
	markPrice: number | null;
	/** Smallest tradeable base quantity; 0 when the venue publishes none. */
	minBase: number;
	/** Smallest tradeable order value in USD; 0 when the venue publishes none. */
	minNotionalUsd: number;
	/**
	 * The venue's size precision, in decimal places. **Null until it has been
	 * read**, and never defaulted.
	 *
	 * A default here is not a cosmetic inaccuracy, it inverts the request. The
	 * reduce path quantizes UP (see `quantizeTargetTowardCurrent`), so a lot
	 * coarser than the real one turns a reduction into an increase: with the
	 * `2` this once defaulted to, halving a 0.00032 BTC leg to 0.00016 resolved
	 * to `quantizeBaseUp(0.00016, 2)` = **0.01 BTC** — 62x the request, $772
	 * against the $12 asked for. Measured live; it left a $25 delta-neutral
	 * pair holding a $132 naked short.
	 *
	 * So an unread precision is a `precision-unknown` problem, which blocks the
	 * form, rather than a number the quantizer will happily use.
	 */
	sizeDecimals: number | null;
}

export type ResizeProblemKind =
	| "not-positive"
	| "no-change"
	| "order-below-floor"
	| "result-below-floor"
	| "precision-unknown";

export interface ResizeProblem {
	kind: ResizeProblemKind;
	leg: "long" | "short" | "both";
	/** A sentence the user reads, naming the leg and the number that is wrong. */
	message: string;
}

/** What one leg would do, once the targets are quantized. */
export interface ResizeLegPlan {
	side: "long" | "short";
	currentBase: number;
	/** The target after quantization — what the leg would actually hold. */
	targetBase: number;
	/** Signed: positive increases the leg, negative reduces it. */
	deltaBase: number;
	/** `deltaBase` priced at the leg's mark. Signed, same convention. */
	deltaUsd: number;
	/** The notional the leg would carry afterwards. */
	targetNotionalUsd: number;
}

export interface ResizePlan {
	legs: { long: ResizeLegPlan | null; short: ResizeLegPlan | null };
	/** Base quantity of net exposure the resize would leave. */
	netDeltaBase: number | null;
	/** True when both legs would end at the same base size. */
	neutral: boolean;
	/** Every reason this cannot be submitted, in the order they were found. */
	problems: ResizeProblem[];
	/** True when at least one leg would place an order and nothing is wrong. */
	submittable: boolean;
}

const LABEL: Record<"long" | "short", string> = {
	long: "long",
	short: "short",
};

function formatBaseForMessage(value: number): string {
	if (!Number.isFinite(value)) return "—";
	return Number(value.toFixed(8)).toLocaleString("en-US", {
		maximumFractionDigits: 8,
	});
}

function formatUsdForMessage(value: number): string {
	if (!Number.isFinite(value)) return "$—";
	return `$${Number(value.toFixed(2)).toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
}

/**
 * Round a base quantity DOWN to a venue lot.
 *
 * Byte-identical to the server's `quantizeBaseDown`, including the 1e-9 guard
 * that keeps an already-aligned quantity from being pushed a whole lot lower by
 * float error. Duplicated rather than shared because the two live in separate
 * deployables with no common package for venue arithmetic; the tests on both
 * sides pin the same values.
 */
export function quantizeBaseDown(base: number, decimals: number): number {
	if (!Number.isFinite(base) || base <= 0) return 0;
	const lot = 10 ** -Math.max(0, decimals);
	return Number(
		(Math.floor(base / lot + 1e-9) * lot).toFixed(Math.max(0, decimals)),
	);
}

/** Round a base quantity UP to a venue lot. The server's `quantizeBaseUp`. */
export function quantizeBaseUp(base: number, decimals: number): number {
	if (!Number.isFinite(base) || base <= 0) return 0;
	const lot = 10 ** -Math.max(0, decimals);
	return Number(
		(Math.ceil(base / lot - 1e-9) * lot).toFixed(Math.max(0, decimals)),
	);
}

/**
 * Round a TARGET to a venue lot, always toward where the position already is.
 *
 * The server's `quantizeTargetTowardCurrent`, and the rule it encodes is the one
 * the whole feature rounds by: **a resize never moves the position further than
 * the user asked**. An increase rounds down (buy at most what was requested), a
 * reduce rounds up (sell at most what was requested).
 *
 * Mirrored here so the form can show the number that will really be traded
 * rather than the raw one typed — a user who asks for 12.347 on a two-decimal
 * venue should see 12.34 before they sign, not after.
 */
export function quantizeTargetTowardCurrent(
	target: number,
	currentBase: number,
	decimals: number,
): number {
	return target >= currentBase
		? quantizeBaseDown(target, decimals)
		: quantizeBaseUp(target, decimals);
}

/** Base <-> USD, through the leg's own mark. Null when the mark is unusable. */
export function baseToUsd(base: number, mark: number | null): number | null {
	if (mark === null || !(mark > 0) || !Number.isFinite(base)) return null;
	return base * mark;
}

export function usdToBase(usd: number, mark: number | null): number | null {
	if (mark === null || !(mark > 0) || !Number.isFinite(usd)) return null;
	return usd / mark;
}

/** Both legs end at the same base size, within venue-quantization dust. */
function isNeutralResult(longBase: number, shortBase: number): boolean {
	const scale = Math.max(longBase, shortBase, 1e-9);
	return Math.abs(longBase - shortBase) <= scale * 1e-6;
}

/**
 * Plan a resize from the targets the form holds.
 *
 * `targets` are RAW — what the user typed, before quantization — and a null
 * leaves that leg alone, which is how a single-leg resize is expressed. The
 * plan reports what the venues would really do with them.
 *
 * `linked` says the two legs must end at the same size, and it changes the
 * quantization the same way the server's does: one shared target on the COARSER
 * of the two lots, so both legs can actually land on the identical number.
 * Rounding each leg on its own precision would leave a linked pair a fraction
 * of a lot apart — a net delta the user never asked for.
 */
export function planResize(params: {
	long: ResizeLegInput;
	short: ResizeLegInput;
	targets: { long: number | null; short: number | null };
	linked: boolean;
}): ResizePlan {
	const { long, short, targets, linked } = params;
	const problems: ResizeProblem[] = [];
	const empty: ResizePlan = {
		legs: { long: null, short: null },
		netDeltaBase: null,
		neutral: true,
		problems,
		submittable: false,
	};

	// Without both current sizes and both marks nothing here can be computed.
	// The form shows a loading state rather than a plan; it must never guess,
	// for the same reason the server's decision refuses an unreadable leg.
	if (
		long.currentBase === null ||
		short.currentBase === null ||
		!(long.markPrice !== null && long.markPrice > 0) ||
		!(short.markPrice !== null && short.markPrice > 0)
	) {
		return empty;
	}

	for (const [side, target] of [
		["long", targets.long],
		["short", targets.short],
	] as const) {
		if (target !== null && !(target > 0)) {
			problems.push({
				kind: "not-positive",
				leg: side,
				message:
					"A target size must be greater than zero. To exit the position entirely, close it instead.",
			});
		}
	}
	if (problems.length > 0) return { ...empty, problems };

	// Quantization needs a real lot size. A linked pair rounds BOTH legs against
	// the coarser of the two, so either one being unknown blocks the pair; an
	// unlinked resize blocks only the leg being moved. Refusing here is what
	// stops a reduce from rounding up into an increase.
	for (const [leg, target] of [
		[long, targets.long],
		[short, targets.short],
	] as const) {
		const needed = linked
			? long.sizeDecimals === null || short.sizeDecimals === null
			: target !== null && leg.sizeDecimals === null;
		if (!needed) continue;
		problems.push({
			kind: "precision-unknown",
			leg: linked ? "both" : leg.side,
			message:
				"Waiting for the venue's size precision. Resizing before it is known could round the order the wrong way.",
		});
		break;
	}
	if (problems.length > 0) return { ...empty, problems };

	const coarserDecimals = Math.min(
		long.sizeDecimals as number,
		short.sizeDecimals as number,
	);
	// A linked pair rounds against the midpoint of the two legs rather than each
	// leg's own size, so both get the SAME resolved target even when the legs
	// have drifted apart and one is increasing while the other reduces.
	const linkedReference = (long.currentBase + short.currentBase) / 2;

	const planLeg = (leg: ResizeLegInput, target: number | null): ResizeLegPlan => {
		const current = leg.currentBase as number;
		const mark = leg.markPrice as number;
		const resolved =
			target === null
				? current
				: quantizeTargetTowardCurrent(
						target,
						linked ? linkedReference : current,
						linked ? coarserDecimals : (leg.sizeDecimals as number),
					);
		const deltaBase = resolved - current;
		return {
			side: leg.side,
			currentBase: current,
			targetBase: resolved,
			deltaBase,
			deltaUsd: deltaBase * mark,
			targetNotionalUsd: resolved * mark,
		};
	};

	const longPlan = planLeg(long, targets.long);
	const shortPlan = planLeg(short, targets.short);
	const legs = { long: longPlan, short: shortPlan };

	const moving = (
		[
			[longPlan, long],
			[shortPlan, short],
		] as const
	).filter(([plan]) => Math.abs(plan.deltaBase) > 0);

	if (moving.length === 0) {
		const wantedToMove =
			(targets.long !== null &&
				Math.abs(targets.long - (long.currentBase as number)) > 0) ||
			(targets.short !== null &&
				Math.abs(targets.short - (short.currentBase as number)) > 0);
		if (wantedToMove) {
			problems.push({
				kind: "no-change",
				leg: "both",
				message:
					"That change is smaller than the smallest size step these venues trade in, so no order could be placed.",
			});
		}
		return {
			legs,
			netDeltaBase: longPlan.targetBase - shortPlan.targetBase,
			neutral: isNeutralResult(longPlan.targetBase, shortPlan.targetBase),
			problems,
			submittable: false,
		};
	}

	for (const [plan, leg] of moving) {
		const orderBase = Math.abs(plan.deltaBase);
		const mark = leg.markPrice as number;

		if (leg.minBase > 0 && orderBase < leg.minBase) {
			problems.push({
				kind: "order-below-floor",
				leg: leg.side,
				message: `The ${LABEL[leg.side]} leg would trade ${formatBaseForMessage(orderBase)} — below its venue's ${formatBaseForMessage(leg.minBase)} minimum.`,
			});
		} else if (
			leg.minNotionalUsd > 0 &&
			orderBase * mark < leg.minNotionalUsd
		) {
			problems.push({
				kind: "order-below-floor",
				leg: leg.side,
				message: `The ${LABEL[leg.side]} leg would trade ${formatUsdForMessage(orderBase * mark)} — below its venue's ${formatUsdForMessage(leg.minNotionalUsd)} minimum.`,
			});
		}

		// A REDUCE only. What the leg would be LEFT holding has to clear the same
		// floors, because a position below a venue minimum cannot be closed
		// afterwards — the user would be stuck with it. An increase needs no such
		// check: whatever was closeable before still is.
		if (plan.deltaBase < 0) {
			const left = plan.targetBase;
			const belowBase = leg.minBase > 0 && left < leg.minBase;
			const belowNotional =
				leg.minNotionalUsd > 0 && left * mark < leg.minNotionalUsd;
			if (belowBase || belowNotional) {
				problems.push({
					kind: "result-below-floor",
					leg: leg.side,
					message: `That would leave ${formatBaseForMessage(left)} on the ${LABEL[leg.side]} leg, which is under its venue's minimum and could not be closed afterwards. Close the position instead.`,
				});
			}
		}
	}

	return {
		legs,
		netDeltaBase: longPlan.targetBase - shortPlan.targetBase,
		neutral: isNeutralResult(longPlan.targetBase, shortPlan.targetBase),
		problems,
		submittable: problems.length === 0,
	};
}
