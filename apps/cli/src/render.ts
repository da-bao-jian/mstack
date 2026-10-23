import type { Snapshot } from "@mstack/funding";
import type { Opportunity } from "@mstack/opportunities";
import { number, paint, type Terminal, usd } from "./format.ts";

export function clean(value: unknown): string {
	const text =
		value === null || value === undefined
			? "—"
			: typeof value === "object"
				? JSON.stringify(value)
				: typeof value === "number"
					? number(value, Number.isInteger(value) ? 0 : 4)
					: String(value);
	return text.replace(/[\p{Cc}\p{Cf}]/gu, " ");
}

export function table(headers: string[], rows: unknown[][]): string {
	const cells = [headers, ...rows].map((row) => row.map(clean));
	const widths = headers.map((_, i) =>
		Math.max(...cells.map((row) => [...row[i]].length)),
	);
	return cells
		.map((row) =>
			row
				.map((cell, i) => cell + " ".repeat(widths[i] - [...cell].length))
				.join("  ")
				.trimEnd(),
		)
		.join("\n");
}

export function pct(value: number | null, digits = 4): string {
	return value === null ? "—" : `${number(value, digits)}%`;
}

export function footer(
	snapshot: Pick<Snapshot, "observedAt" | "source" | "failed">,
	unmatched: number,
	now: number,
): string {
	return `snapshot age: ${Math.max(0, (now - snapshot.observedAt) / 1000).toFixed(1)}s | source: ${snapshot.source} | annualized = simple, not compounded\nfailed: ${snapshot.failed.length ? snapshot.failed.map((f) => `${clean(f.venue)} (${clean(f.error)})`).join("; ") : "none"} | unmatched: ${unmatched}`;
}

export { scanView } from "./scan-view.ts";

type Realized = { d1: number | null; d7: number | null; d30: number | null };

/** The three realized-spread cells, or none when the scan did not read history. */
export function realizedCells(row: { realized?: Realized }): string[] {
	if (!row.realized) return [];
	return [row.realized.d1, row.realized.d7, row.realized.d30].map((value) =>
		value === null ? "—" : pct(value, 2),
	);
}

export const REALIZED_HEADERS = ["1d real/yr", "7d real/yr", "30d real/yr"];

function scanTable(
	view: (Opportunity & { realized?: Realized })[],
	executable: boolean,
): string {
	const realized = view.some((row) => row.realized);
	return table(
		[
			"base",
			"long",
			"short",
			"spread/yr",
			"net APY",
			"fees",
			"entry (mark est.)",
			"vol24h (long/short)",
			"OI (long/short)",
			"break-even h",
			...(realized ? REALIZED_HEADERS : []),
			...(executable ? [] : ["EXEC"]),
			"flags",
		],
		view.map((r) => [
			r.base,
			`${r.long.venue}:${r.long.market}`,
			`${r.short.venue}:${r.short.market}`,
			pct(r.spreadAnnualizedPct, 2),
			pct(r.netApyPct, 2),
			pct(r.roundTripFeePct + r.builderFeePct),
			pct(r.entryCostPct),
			`${usd(r.long.volume24hUsd)}/${usd(r.short.volume24hUsd)}`,
			`${usd(r.long.openInterestUsd)}/${usd(r.short.openInterestUsd)}`,
			r.breakEvenHours?.toFixed(2),
			...(realized ? realizedCells(r) : []),
			...(executable ? [] : [r.executable ? "EXEC" : "—"]),
			r.flags.join(",") || "—",
		]),
	);
}

export function renderScan(
	view: {
		executable: (Opportunity & { realized?: Realized })[];
		anywhere: (Opportunity & { realized?: Realized })[];
	},
	executableOnly = false,
	holdDays = 7,
	sizeUsd?: number,
	terminal: Terminal = {},
): string {
	const size = sizeUsd === undefined ? "" : `$${number(sizeUsd, 0)} per leg, `;
	return [
		`Net APY estimate: ${size}${holdDays}-day hold; annualized = simple, not compounded`,
		paint("Executable on MoB", "sky", terminal),
		scanTable(view.executable, true),
		...(executableOnly
			? []
			: [
					paint("\nBest anywhere", "sky", terminal),
					scanTable(view.anywhere, false),
				]),
	].join("\n");
}
