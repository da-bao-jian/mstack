import type { Snapshot } from "@mobstack/funding";
import type { Opportunity } from "@mobstack/opportunities";

export function clean(value: unknown): string {
	const text =
		value === null || value === undefined
			? "—"
			: typeof value === "object"
				? JSON.stringify(value)
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
	return value === null ? "—" : `${value.toFixed(digits)}%`;
}

export function footer(
	snapshot: Pick<Snapshot, "observedAt" | "source" | "failed">,
	unmatched: number,
	now: number,
): string {
	return `snapshot age: ${Math.max(0, (now - snapshot.observedAt) / 1000).toFixed(1)}s | source: ${snapshot.source} | annualized = simple, not compounded\nfailed: ${snapshot.failed.length ? snapshot.failed.map((f) => `${clean(f.venue)} (${clean(f.error)})`).join("; ") : "none"} | unmatched: ${unmatched}`;
}

export { scanView } from "./scan-view.ts";

function usd(value: number | undefined): string {
	if (value === undefined) return "—";
	for (const [scale, suffix] of [
		[1e9, "B"],
		[1e6, "M"],
		[1e3, "K"],
	] as const)
		if (value >= scale) return `$${(value / scale).toFixed(1)}${suffix}`;
	return `$${value.toFixed(0)}`;
}

function scanTable(view: Opportunity[], executable: boolean): string {
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
			...(executable ? [] : [r.executable ? "EXEC" : "—"]),
			r.flags.join(",") || "—",
		]),
	);
}

export function renderScan(
	view: { executable: Opportunity[]; anywhere: Opportunity[] },
	executableOnly = false,
	holdDays = 7,
): string {
	return [
		`Net APY estimate: ${holdDays}-day hold; annualized = simple, not compounded`,
		"Executable on Mobius",
		scanTable(view.executable, true),
		...(executableOnly
			? []
			: ["\nBest anywhere", scanTable(view.anywhere, false)]),
	].join("\n");
}
