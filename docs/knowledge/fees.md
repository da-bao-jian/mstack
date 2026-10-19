# Fees

## Simple

A funding spread must pay for entering and leaving both positions. The scanner includes taker fees on both legs and the MoB builder fee on the Hyperliquid leg. That builder fee doubles when the other leg is Lighter. The default fees are estimates. Your account tier and market terms can change them.

## Precise

One basis point is 0.01%. Round-trip taker cost is `2 × (longFeeBps + shortFeeBps) / 100` percent. The default builder setting is 15 tenths of a basis point, or 1.5 bps. It applies on entry and exit of the HL leg; multiply it by two when paired with either Lighter deployment. Pairs without HL have zero builder cost. Default taker bps are HL 4.5, Lighter 0, Lighter mainnet 0, Aster 3.5, Binance 5, Bybit 5.5, OKX 5, MEXC 2, BingX 5, Bitget 6, Gate 7.5, GRVT 4.5, Variational 0, and QFEX 10. The seven added on 2026-10-18 are published base-tier taker rates: MEXC and Gate from their contract feeds, BingX and Bitget from their contract lists, GRVT from its public fee schedule, Variational charges no trading fee and earns the spread, and QFEX tier 5 for single stocks (commodities and indices are 5). Override them with config for actual account terms. HL's upstream fee scale is `(deployerScale < 1 ? deployerScale + 1 : deployerScale × 2) × (growthMode ? 0.1 : 1)`; effective fee also multiplies by `1 - referralDiscount`. W3 does not fetch those account inputs. Break-even is `(takerPct + builderPct + signedEntryCostPct) / hourlySpreadPct`; it is zero for nonpositive measured cost and unknown when marks are missing. Mark estimates omit execution depth and future exit basis.

Sources: `reference/upstream/tg-monitor/README.md`; its `scanner.ts` pure fee functions; `docs/PRD.md` §4.3 and §9.4.
