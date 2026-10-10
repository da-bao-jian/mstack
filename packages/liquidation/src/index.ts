// Ported from mobius@33ed2ece packages/liquidation/src/index.ts
export {
	crossDistanceToLiqPct,
	distanceToLiqPct,
	distSlopePerUsd,
	estimateCrossLiquidationPrice,
	estimateLiquidationPrice,
	HEALTH_CAUTION_PCT,
	HEALTH_HEALTHY_PCT,
	healthBarFraction,
	healthTone,
	hlMaintenanceMarginFraction,
} from "./distance.ts";
export type { DnHealthTone, DnSide, MarginMode } from "./distance.ts";
export {
	distanceAfterTrimPct,
	largestUsableThresholdPct,
	LIQ_PROTECTION_DEFAULT_PCT,
	LIQ_PROTECTION_TARGET_MULT,
	liqProtectionTargetPct,
	NotImplementedError,
	protectionOpenBlock,
	type ProtectionOpenBlock,
	trimFractionToTarget,
} from "./trim.ts";
