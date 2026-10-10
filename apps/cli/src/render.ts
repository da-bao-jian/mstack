import type { Snapshot } from "../../../packages/funding/src/main.ts";
import type {
	Opportunity,
	RankedOpportunities,
} from "../../../packages/opportunities/src/index.ts";

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
}

export function scanView(
	result: RankedOpportunities,
	options: ViewOptions,
): Opportunity[] {
	const rows = result.opportunities.filter(
		(r) =>
			(!options.market || r.base === options.market) &&
			(!options.executable || r.executable) &&
			(options.minApy === undefined || r.spreadAnnualizedPct >= options.minApy),
	);
	const priority = (r: Opportunity) =>
		r.qualifies ? (r.executable ? 2 : 1) : 0;
	rows.sort(
		(a, b) =>
			priority(b) - priority(a) ||
			b.spreadAnnualizedPct - a.spreadAnnualizedPct,
	);
	const seen = new Set<string>();
	return rows
		.filter((r) => {
			if (options.allPairs) return true;
			if (seen.has(r.base)) return false;
			seen.add(r.base);
			return true;
		})
		.slice(0, options.top);
}

export function renderScan(view: Opportunity[]): string {
	return table(
		[
			"base",
			"long",
			"short",
			"spread/yr",
			"fees",
			"entry cost",
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
			r.breakEvenHours?.toFixed(2),
			r.executable ? "EXEC" : "—",
			r.flags.join(",") || "—",
		]),
	);
}
