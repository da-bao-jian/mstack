import type { Snapshot } from "@mobstack/funding";
import type { Opportunity, RankedOpportunities } from "@mobstack/opportunities";

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

export interface ViewOptions {
	market?: string;
	top: number;
	allPairs: boolean;
	executable: boolean;
	minApy?: number;
	includeThin?: boolean;
}

export function scanView(
	result: RankedOpportunities,
	options: ViewOptions,
): { view: Opportunity[]; thinHidden: number } {
	const candidates = result.opportunities.filter(
		(r) =>
			(!options.market || r.base === options.market) &&
			(!options.executable || r.executable) &&
			(options.minApy === undefined || r.spreadAnnualizedPct >= options.minApy),
	);
	const rows = candidates.filter(
		(r) => options.includeThin || !r.flags.includes("thin"),
	);
	const thinHidden = candidates.length - rows.length;
	const priority = (r: Opportunity) =>
		r.qualifies ? (r.executable ? 2 : 1) : 0;
	rows.sort(
		(a, b) =>
			priority(b) - priority(a) ||
			b.spreadAnnualizedPct - a.spreadAnnualizedPct,
	);
	const seen = new Set<string>();
	const view = rows
		.filter((r) => {
			if (options.allPairs) return true;
			if (seen.has(r.base)) return false;
			seen.add(r.base);
			return true;
		})
		.slice(0, options.top);
	return { view, thinHidden };
}

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

export function renderScan(view: Opportunity[]): string {
	return table(
		[
			"base",
			"long",
			"short",
			"spread/yr",
			"fees",
			"entry (mark est.)",
			"vol24h (long/short)",
			"OI (long/short)",
			"break-even h",
			"EXEC",
			"flags",
		],
		view.map((r) => [
			r.base,
			`${r.long.venue}:${r.long.market}`,
			`${r.short.venue}:${r.short.market}`,
			pct(r.spreadAnnualizedPct, 2),
			pct(r.roundTripFeePct + r.builderFeePct),
			pct(r.entryCostPct),
			`${usd(r.long.volume24hUsd)}/${usd(r.short.volume24hUsd)}`,
			`${usd(r.long.openInterestUsd)}/${usd(r.short.openInterestUsd)}`,
			r.breakEvenHours?.toFixed(2),
			r.executable ? "EXEC" : "—",
			r.flags.join(",") || "—",
		]),
	);
}
