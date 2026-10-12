import {
	detectMode,
	type Mode,
	renderBrandPalette,
	renderTerminalLogo,
	style,
} from "@mstack/brand";
import {
	collectHome,
	type HomeData,
	homeVenues,
	type Reading,
} from "./home-data.ts";
import { collectHomeMarket, type HomeMarket } from "./home-market.ts";
import { reachabilityLabel } from "./reachability.ts";
import type { Runtime } from "./run.ts";

export interface HomeOptions {
	big?: boolean;
	compact?: boolean;
	plain?: boolean;
	ascii?: boolean;
	offline?: boolean;
	json?: boolean;
	stacked?: boolean;
	suppressKeyLegal?: boolean;
	readyVenues?: string[];
}
const clean = (text: string) => text.replace(/[\p{Cc}\p{Cf}]/gu, "");
function readText<T>(
	reading: Reading<T>,
	format: (value: T) => string,
): string {
	return ["ok", "slow"].includes(reading.state) && reading.value !== undefined
		? format(reading.value)
		: reading.state;
}
function upgradeText(data: HomeData) {
	return readText(data.upgrade, ({ available }) =>
		available ? `available ${available}` : "none",
	);
}
function legalText(data: HomeData) {
	return readText(data.legal, ({ accepted, acceptedAt }) =>
		accepted
			? `accepted${acceptedAt ? ` ${acceptedAt.slice(0, 10)}` : ""}`
			: "not accepted",
	);
}
function keyText(data: HomeData) {
	if (!data.key.description)
		// TODO(W20): Replace this with `mob onboard` when onboarding lands.
		return data.key.state === "unreachable"
			? `unreachable${data.key.error ? `: ${data.key.error}` : ""}`
			: "none · run mob keys import";
	const suffix =
		data.key.state === "ok" && data.key.latencyMs !== undefined
			? `ok · ${data.key.latencyMs} ms`
			: data.key.state;
	return `${data.key.description.prefix} (${data.key.description.backend}) · ${suffix}`;
}
function textMode(text: string, mode: Mode) {
	return mode !== "ascii"
		? text
		: text
				.replaceAll("✓", "+")
				.replaceAll("✗", "x")
				.replaceAll("–", "-")
				.replaceAll("−", "-")
				.replaceAll("─", "-")
				.replaceAll("·", ".")
				.replaceAll("…", "...")
				.replaceAll("→", "->");
}
export async function home(options: HomeOptions, rt: Runtime): Promise<void> {
	if (options.big && options.compact)
		throw new Error("Choose --big or --compact");
	if (options.plain && options.ascii)
		throw new Error("Choose --plain or --ascii");
	const terminal = {
		env: rt.env ?? process.env,
		isTTY: rt.stdoutIsTTY ?? rt.isTTY ?? Boolean(process.stdout.isTTY),
	};
	const forcedMode: Mode | undefined = options.ascii
		? "ascii"
		: options.plain
			? "mono"
			: undefined;
	const size = options.big ? 60 : 32;
	const [data, market] = await Promise.all([
		collectHome(rt, {
			...options,
			offline: options.offline || options.suppressKeyLegal,
		}),
		collectHomeMarket(rt, options),
	]);
	if (options.json) {
		rt.out(JSON.stringify({ ...data, market }, null, 2));
		return;
	}
	const { lines: logo, mode } = renderTerminalLogo({
		size,
		terminal,
		...(forcedMode ? { mode: forcedMode } : {}),
		markers: false,
	});
	const colorTerminal = {
		...terminal,
		isTTY: terminal.isTTY && mode !== "mono" && mode !== "ascii",
	};
	const paint = (value: string, color: Parameters<typeof style>[1]) =>
		style(value, color, colorTerminal);
	const label = (value: string) => paint(value.padEnd(11), "orange");
	const status = (value: string) =>
		value
			.split(/(✓|✗|–)/u)
			.map((part) =>
				part === "✓"
					? paint(part, "sky")
					: part === "✗"
						? paint(part, "orange")
						: part === "–"
							? paint(part, "dim")
							: /unreachable|needs repair|^auto ·/i.test(part)
								? paint(part, "orange")
								: part,
			)
			.join("");
	const row = (name: string, value: string) =>
		textMode(`${label(name)}${status(clean(value))}`, mode);
	const continuation = (value: string) =>
		textMode(`${" ".repeat(11)}${clean(value)}`, mode);
	const money = (value: number) => {
		const abs = Math.abs(value);
		const [divisor, suffix] =
			abs >= 1e9
				? [1e9, "B"]
				: abs >= 1e6
					? [1e6, "M"]
					: abs >= 1e3
						? [1e3, "K"]
						: [1, ""];
		return `$${(value / divisor).toFixed(divisor === 1 ? 0 : 1)}${suffix}`;
	};
	const signed = (value: number, digits = 0) =>
		`${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}`;
	const pairText = (pair: HomeMarket["topPairs"][number]) =>
		`${pair.base.padEnd(7)}long ${pair.longVenue} · short ${pair.shortVenue}  ${Math.round(pair.netApyPct)}% net${pair.volume24hUsd === undefined ? "" : `  ${money(pair.volume24hUsd)}`}`;
	const info: string[] = [];
	const owner = data.owner
		? `${data.owner.slice(0, 6)}…${data.owner.slice(-4)}`
		: "new account";
	const heading = `mstack ${data.version} · ${owner}`;
	info.push(paint(textMode(heading, mode), "navy"));
	info.push(paint(textMode("─".repeat(heading.length), mode), "sky"));
	if (market.topPairs.length) {
		market.topPairs.forEach((pair, index) => {
			info.push(
				index ? continuation(pairText(pair)) : row("Top pairs", pairText(pair)),
			);
		});
	} else {
		info.push(row("Top pairs", "venues unreachable · mob scan to retry"));
	}
	market.trending.forEach((item, index) => {
		const change =
			item.priceChange24hPct === undefined
				? ""
				: ` · price ${signed(item.priceChange24hPct, 1)}%`;
		const value = `${item.base.padEnd(7)}${money(item.volume24hUsd)} 24h · funding ${signed(item.annualizedPct)}%/yr${item.openInterestUsd === undefined ? "" : ` · OI ${money(item.openInterestUsd)}`}${change}`;
		info.push(index ? continuation(value) : row("Trending", value));
	});
	if (data.key.description && data.tasks.value?.running.count) {
		const running = data.tasks.value.running;
		info.push(
			row(
				"Positions",
				`${running.count} running${running.sizeUsd === undefined ? "" : ` · ${money(running.sizeUsd)} per leg`}${running.fundingUsdPerDay === undefined ? "" : ` · est. funding ${signed(running.fundingUsdPerDay, 2)}/day`}`,
			),
		);
	}
	const accepted = data.legal.value?.accepted === true;
	const ready =
		options.suppressKeyLegal === true ||
		Boolean(
			data.owner &&
				accepted &&
				data.key.description &&
				homeVenues.some((venue) => data.venues[venue].value?.ready),
		);
	if (ready) {
		const venues = options.readyVenues?.length
			? options.readyVenues.map((venue) => `${venue} ✓`)
			: homeVenues
					.filter((venue) => data.venues[venue].value?.bound)
					.map(
						(venue) =>
							`${venue} ${data.venues[venue].value?.ready ? "✓" : "✗"}`,
					);
		const key = data.key.description;
		const cap = key?.meta.maxSizeUsd;
		const keyCheck =
			data.key.state === "ok"
				? "✓"
				: data.key.state === "rejected" || data.key.state === "unreachable"
					? "✗"
					: "–";
		info.push(
			row(
				"Ready",
				`${venues.join("  ")}${venues.length ? " · " : ""}key ${key?.prefix ?? "none"} ${keyCheck}${cap === undefined ? "" : ` · cap ${money(cap)}`}`,
			),
		);
	} else {
		const legal = accepted ? "✓" : "✗";
		info.push(
			row(
				"Onboarding",
				`legal ${legal} · hl – · lighter – · key ${data.key.description?.prefix ?? "none"}`,
			),
		);
	}
	const policy =
		data.policy === "manual"
			? "manual · you approve each Proposal by naming it"
			: data.policy === "auto"
				? "auto · the agent may submit inside the key's caps"
				: "locked · reads only";
	info.push(row("Policy", policy));
	const awaiting = data.proposals.value?.awaiting[0];
	const next = awaiting
		? `mob sign ${awaiting}`
		: !ready
			? 'say "set me up"'
			: market.topPairs[0]
				? `say "open ${market.topPairs[0].base}"   or   mob scan`
				: "mob scan";
	info.push(row("Next", next));
	const freshness = freshnessText(market);
	const palette =
		mode === "truecolor" || mode === "ansi256"
			? renderBrandPalette({ mode })
			: "";
	const columns = rt.columns ?? process.stdout.columns ?? 80;
	const stacked = options.stacked || columns < 72;
	if (!stacked) while (info.length < logo.length - 1) info.push("");
	info.push(
		`${paint(freshness, market.freshness.state === "live" ? "sky" : "orange")}${palette ? `          ${palette}` : ""}`,
	);
	const lines = stacked
		? [...logo, "", ...info]
		: Array.from({ length: Math.max(logo.length, info.length) }, (_, index) => {
				const left = logo[index] ?? "";
				return `${left}${" ".repeat(size - Bun.stringWidth(left) + 3)}${info[index] ?? ""}`.trimEnd();
			});
	const marked = !terminal.isTTY || mode === "ascii";
	rt.out((marked ? ["<<<MOB", ...lines, "MOB>>>"] : lines).join("\n"));
}

function freshnessText(market: HomeMarket): string {
	const { freshness } = market;
	if (freshness.state === "live") {
		const timedOut = freshness.failed.length
			? ` · ${freshness.failed.join(", ")} timed out`
			: "";
		return `live · ${freshness.succeeded} of ${freshness.total} venues · ${((freshness.durationMs ?? 0) / 1000).toFixed(1)} s${timedOut}`;
	}
	if (freshness.state === "cached" && freshness.ageMs !== undefined)
		return `cached ${Math.max(1, Math.round(freshness.ageMs / 60_000))} min ago`;
	return "offline";
}

interface Check {
	name: string;
	status: "pass" | "fail" | "skip";
	critical: boolean;
	detail: string;
}
export async function doctor(json: boolean, rt: Runtime): Promise<number> {
	const data = await collectHome(rt, { doctor: true });
	const checks: Check[] = [];
	const add = (
		name: string,
		pass: boolean | null,
		detail: string,
		critical = true,
	) =>
		checks.push({
			name,
			status: pass === null ? "skip" : pass ? "pass" : "fail",
			critical,
			detail,
		});
	function network<T>(
		name: string,
		reading: Reading<T>,
		passes: (value: T) => boolean,
		detail: (value: T) => string,
		critical = true,
	) {
		add(
			name,
			["ok", "slow"].includes(reading.state) && reading.value !== undefined
				? passes(reading.value)
				: reading.state === "not checked"
					? null
					: false,
			["ok", "slow"].includes(reading.state) && reading.value !== undefined
				? detail(reading.value)
				: `${reading.state}${reading.error ? `: ${reading.error}` : ""}`,
			critical,
		);
	}
	add("Binary", true, `mob ${data.version}`);
	add(
		"Bun",
		data.diagnostics.bun,
		data.diagnostics.bun
			? "present (for upgrades)"
			: "missing (needed for upgrades)",
		false,
	);
	add(
		"Config",
		data.config.present && data.config.valid,
		data.config.error ??
			(data.config.present ? data.config.path : "not present → run mob setup"),
	);
	add("Owner", Boolean(data.owner), data.owner ?? "not set → run mob setup");
	add(
		"Signer",
		data.diagnostics.signer.usable,
		`${data.signer ?? "not set"}: ${data.diagnostics.signer.detail}`,
	);
	add(
		"Policy",
		data.config.valid,
		`${data.policy}${data.policy === "locked" ? " (mutations disabled)" : ""}`,
	);
	add(
		"Key",
		data.key.description ? data.key.state === "ok" : null,
		keyText(data),
		false,
	);
	network(
		"API",
		data.api,
		() => true,
		({ latencyMs }) => `${data.api.host} ${reachabilityLabel(latencyMs)}`,
	);
	network(
		"Auth",
		data.auth,
		() => true,
		() => `${data.auth.host} ok`,
	);
	network(
		"Legal",
		data.legal,
		(v) => v.accepted,
		() => legalText(data),
	);
	for (const venue of homeVenues) {
		const reading = data.venues[venue];
		// Unbound venues are optional. A bound but broken credential is critical.
		network(
			`Venue ${venue}`,
			reading,
			(v) => v.ready,
			(v) => (v.ready ? "ready" : (v.issue ?? "not bound")),
			reading.value?.issue !== "not_bound",
		);
	}
	network(
		"HL deposit",
		data.diagnostics.hlDeposit,
		Boolean,
		(v) =>
			v
				? "present (perpetual account value > 0)"
				: "no positive perpetual account value",
		data.venues.hl.value?.bound === true,
	);
	for (const venue of ["lighter", "lighter-mainnet"] as const)
		network(
			`${venue} account`,
			data.diagnostics.lighterAccounts[venue],
			Boolean,
			(v) => (v ? "exists" : "create a Lighter account first"),
			data.venues[venue].value?.bound === true,
		);
	network(
		"Proposals",
		data.proposals,
		() => true,
		({ awaiting, expired }) =>
			`${awaiting.length} awaiting signature${awaiting.length ? ` (${awaiting.join(", ")})` : ""} · ${expired.length} expired${expired.length ? ` (${expired.join(", ")})` : ""}`,
	);
	network(
		"Upgrade",
		data.upgrade,
		() => true,
		() => `${upgradeText(data)} (cached origin/main)`,
		false,
	);
	const ok = checks.every((c) => !c.critical || c.status === "pass");
	if (json)
		rt.out(JSON.stringify({ version: data.version, ok, checks }, null, 2));
	else {
		const mode = detectMode({
			env: rt.env ?? process.env,
			isTTY: rt.stdoutIsTTY ?? rt.isTTY ?? Boolean(process.stdout.isTTY),
		});
		rt.out(
			checks
				.map((c) =>
					textMode(
						`${c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "–"} ${c.name.padEnd(23)} ${clean(c.detail)}${!c.critical ? " (optional)" : ""}`,
						mode,
					),
				)
				.join("\n"),
		);
	}
	return ok ? 0 : 1;
}
