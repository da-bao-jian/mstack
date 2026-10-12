import { join } from "node:path";
import {
	detectMode,
	type Mode,
	renderPalette,
	renderTerminalLogo,
	style,
} from "@mstack/brand";
import {
	collectHome,
	type HomeData,
	homeVenues,
	type Reading,
} from "./home-data.ts";
import { reachabilityLabel } from "./reachability.ts";
import type { Runtime } from "./run.ts";

export interface HomeOptions {
	big?: boolean;
	compact?: boolean;
	plain?: boolean;
	ascii?: boolean;
	offline?: boolean;
	json?: boolean;
	suppressKeyLegal?: boolean;
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
function proposalText(data: HomeData) {
	return readText(data.proposals, ({ awaiting }) =>
		awaiting.length
			? `${awaiting.length} awaiting signature (${awaiting.join(", ")})`
			: "none",
	);
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
	const size = options.compact ? 32 : options.big ? 60 : 44;
	const data = await collectHome(rt, options);
	if (options.json) {
		rt.out(JSON.stringify(data, null, 2));
		return;
	}
	const { lines: logo, mode } = renderTerminalLogo({
		size,
		terminal,
		...(forcedMode ? { mode: forcedMode } : {}),
	});
	if (options.compact) {
		rt.out(
			[...logo, "", renderPalette({ mode }), "", `Next  ${data.next}`].join(
				"\n",
			),
		);
		return;
	}
	const envHome = terminal.env.HOME;
	const configPath =
		envHome && data.config.path === join(envHome, ".mob/config.json")
			? "~/.mob/config.json"
			: data.config.path;
	const rows: [string, string][] = [
		[
			"API",
			`${data.api.host}  ${readText(data.api, ({ latencyMs }) => reachabilityLabel(latencyMs))}`,
		],
		[
			"Auth",
			`${data.auth.host}  ${readText(data.auth, ({ latencyMs }) => reachabilityLabel(latencyMs))}`,
		],
		[
			"Owner",
			data.owner
				? `${data.owner.slice(0, 6)}…${data.owner.slice(-4)}`
				: "not set → run mob setup",
		],
		["Signer", data.signer ?? "not set"],
		[
			"Policy",
			data.policy === "auto"
				? style(
						"auto · the agent may submit inside the key's caps",
						"warning",
						{
							...terminal,
							isTTY: terminal.isTTY && mode !== "mono" && mode !== "ascii",
						},
					)
				: data.policy,
		],
		...(options.suppressKeyLegal
			? []
			: ([
					["Key", keyText(data)],
					["Legal", legalText(data)],
				] as [string, string][])),
		[
			"Venues",
			homeVenues
				.map(
					(v) =>
						`${v} ${readText(data.venues[v], (state) => (state.ready ? "✓" : state.issue === "not_bound" ? "–" : `✗ (${state.issue})`))}`,
				)
				.join("  "),
		],
		[
			"Tasks",
			readText(
				data.tasks,
				(counts) =>
					Object.entries(counts)
						.map(([state, count]) => `${count} ${state}`)
						.join(" · ") || "none",
			),
		],
		["Proposals", proposalText(data)],
		[
			"Config",
			`${configPath}${data.config.error ? ` · invalid: ${data.config.error}` : ""}`,
		],
		["Upgrade", upgradeText(data)],
	];
	const heading = `mstack ${data.version}  ·  mob`;
	const info = [
		style(textMode(heading, mode), "bold", {
			...terminal,
			isTTY: terminal.isTTY && mode !== "mono" && mode !== "ascii",
		}),
		textMode("─".repeat(heading.length), mode),
		...rows.map(([key, value]) =>
			textMode(`${key.padEnd(10)}${clean(value)}`, mode),
		),
	];
	const lines =
		!terminal.isTTY || (rt.columns ?? process.stdout.columns ?? 80) < 90
			? [...logo, "", ...info]
			: Array.from({ length: Math.max(logo.length, info.length) }, (_, i) => {
					const left = logo[i] ?? "";
					return `${left}${" ".repeat(size - Bun.stringWidth(left) + 3)}${info[i] ?? ""}`.trimEnd();
				});
	rt.out(
		[
			...lines,
			...(data.api.state === "slow" || data.api.state === "unreachable"
				? [`API ${data.api.state}; venue reads are unaffected`]
				: []),
			"",
			renderPalette({ mode }),
			"",
			`Next  ${data.next}`,
		].join("\n"),
	);
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
