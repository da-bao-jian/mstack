import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { verifyApiKey } from "@mstack/keys";
import { MobiusClient } from "@mstack/mobius-client";
import { openSuppressed, openUrl } from "@mstack/signers";
import { getAddress } from "viem";
import pkg from "../package.json";
import {
	getConfig,
	ownerAddress,
	readConfig,
	setConfig,
	UsageError,
} from "./config.ts";
import { paint } from "./format.ts";
import { home } from "./home.ts";
import { cliKeyStore } from "./key-store.ts";
import type { Runtime } from "./run.ts";

const venuesAllowed = ["hl", "lighter", "aster", "lighter-mainnet"] as const;
type Venue = (typeof venuesAllowed)[number];
type Readiness = {
	venue: Venue;
	bound: boolean;
	ready: boolean;
	issue?: string;
};

const handoff = [
	"Then the user copies the key and pastes it into the chat; the agent stores it with `mob keys import --stdin` and the CLI never prints it again.",
	"A human at a terminal may instead run `mob keys import` and paste it hidden.",
];

function venuesFlag(value: unknown): Venue[] {
	if (value === undefined) return [...venuesAllowed];
	const venues = String(value)
		.split(",")
		.map((item) => item.trim()) as Venue[];
	if (
		venues.length < 1 ||
		new Set(venues).size !== venues.length ||
		venues.some((venue) => !venuesAllowed.includes(venue))
	)
		throw new UsageError(
			"venues must contain 1 to 4 unique values: hl, aster, lighter, lighter-mainnet",
		);
	return venues;
}

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Public onboarding read returned an invalid object");
	return value as Record<string, unknown>;
}

function readiness(value: unknown, selected: Venue[]): Readiness[] {
	const root = object(value);
	const raw = root.venues ?? root.readiness;
	const rows: Record<string, unknown>[] = Array.isArray(raw)
		? raw.map(object)
		: raw && typeof raw === "object"
			? Object.entries(raw).map(
					([venue, state]) =>
						({
							venue,
							...object(state),
						}) as Record<string, unknown>,
				)
			: [];
	return selected.map((venue) => {
		const row = rows.find((item) => item.venue === venue);
		if (!row) return { venue, bound: false, ready: false, issue: "not_bound" };
		const issue =
			typeof row.issue === "string"
				? row.issue
				: typeof row.error === "string"
					? row.error
					: undefined;
		const ready = row.ready === true;
		const bound =
			row.bound === true ||
			ready ||
			(issue !== undefined && issue !== "not_bound");
		return { venue, bound, ready, ...(issue ? { issue } : {}) };
	});
}

async function maybeOpen(
	home: string,
	owner: string,
	url: string,
	rt: Runtime,
): Promise<void> {
	const directory = join(home, "onboard");
	const path = join(directory, `${owner.toLowerCase()}.opened`);
	let previous = 0;
	try {
		const raw = await readFile(path, "utf8");
		if (/^\d+\n$/.test(raw)) previous = Number(raw.trim());
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	if (rt.now() - previous < 3_600_000) return;
	const environment = rt.env ?? process.env;
	const noOpen =
		(environment.MOB_NO_OPEN ?? "") !== "" && environment.MOB_NO_OPEN !== "0";
	if (!noOpen && (rt.openUrl || !openSuppressed(environment)))
		await (rt.openUrl ?? openUrl)(url);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await chmod(directory, 0o700);
	const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
	await writeFile(temporary, `${rt.now()}\n`, { flag: "wx", mode: 0o600 });
	await chmod(temporary, 0o600);
	await rename(temporary, path);
}

type Snapshot = {
	legal: boolean;
	legalError?: string;
	venues: Readiness[];
	key: "none" | "ok" | "rejected" | "unreachable";
	prefix?: string;
	cap?: number;
};

async function snapshot(
	selected: Venue[],
	owner: string,
	rt: Runtime,
): Promise<Snapshot> {
	const config = await readConfig(rt.home);
	const authBase = String(getConfig(config, "auth_base"));
	const apiBase = String(getConfig(config, "api_base"));
	const strategyApiBase = String(getConfig(config, "strategy_api_base"));
	const client = (base: string) =>
		new MobiusClient({ base, version: pkg.version, fetch: rt.fetch });
	let legal = false;
	let legalError: string | undefined;
	try {
		legal = (
			await client(authBase).read("/legal/acceptance", { wallet: owner })
		).accepted;
	} catch (error) {
		legalError = error instanceof Error ? error.message : String(error);
	}
	const states = readiness(
		await client(apiBase).read("/api/binding/readiness", {
			ownerAddress: owner,
		}),
		selected,
	);
	const store = await cliKeyStore(rt);
	const description = await store.describe(owner);
	if (!description)
		return {
			legal,
			...(legalError ? { legalError } : {}),
			venues: states,
			key: "none",
		};
	const stored = await store.get(owner);
	if (!stored) throw new Error("Stored key metadata has no key");
	const checked = await verifyApiKey(
		strategyApiBase,
		stored.key,
		rt.fetch,
		rt.now,
	);
	return {
		legal,
		...(legalError ? { legalError } : {}),
		venues: states,
		key: checked.status,
		prefix: description.prefix,
		cap: description.meta.maxSizeUsd,
	};
}

function render(state: Snapshot, rt: Runtime): string {
	const ok = (text: string) => paint(text, "success", rt);
	const warning = (text: string) => paint(text, "warning", rt);
	const danger = (text: string) => paint(text, "danger", rt);
	const lines = [
		`Legal  ${state.legal ? ok("✓ accepted") : danger(`✗ missing${state.legalError ? ` · ${state.legalError}` : ""}`)}`,
		...state.venues.map((row) => {
			const label = row.venue.padEnd(8);
			if (row.ready) return `${label}${ok("✓ bound")}`;
			if (row.bound)
				return `${label}${danger(`✗ needs repair${row.issue ? ` · ${row.issue}` : ""}`)}`;
			return `${label}${warning(`– not bound${row.issue ? ` · ${row.issue}` : ""}`)}`;
		}),
		state.key === "none"
			? `Key    ${warning("– none")}`
			: state.key === "ok"
				? `Key    ${ok(`✓ verified ok · ${state.prefix}`)}`
				: `Key    ${danger(`✗ stored ${state.prefix} · ${state.key}`)}`,
		...handoff,
	];
	return lines.join("\n");
}

function next(state: Snapshot, tty: boolean): string {
	const incomplete = state.venues.find((venue) => !venue.ready);
	if (incomplete) return `Next: bind ${incomplete.venue} on the page`;
	if (state.key === "none")
		return tty
			? "Next: mob keys import --stdin"
			: "Next: paste the key in the chat";
	if (state.key !== "ok") return "Next: mob keys import --stdin";
	return "Ready";
}

export async function onboard(
	values: Record<string, string | boolean | undefined>,
	rt: Runtime,
): Promise<void> {
	const current = await readConfig(rt.home);
	let owner = typeof values.owner === "string" ? values.owner : current.owner;
	if (!owner) {
		if (!rt.stdinIsTTY)
			throw new UsageError("Non-interactive onboard requires --owner");
		owner = (await rt.prompt?.("Owner", ""))?.trim();
		if (!owner) throw new UsageError("Owner is required");
	}
	ownerAddress(owner);
	owner = getAddress(owner);
	await setConfig("owner", owner, rt.home);
	if (typeof values["app-base"] === "string")
		await setConfig("app_base", values["app-base"], rt.home);
	if (values.native === true) {
		const { nativeOnboard } = await import("./ceremony-command.ts");
		await nativeOnboard(values, rt);
		return;
	}
	const config = await readConfig(rt.home);
	const appBase = String(getConfig(config, "app_base"));
	const url = `${appBase}/?nav=api`;
	rt.out(`Open ${url}`);
	const selected = venuesFlag(values.venues);
	const tty = Boolean(rt.stdinIsTTY && rt.stdoutIsTTY);
	const watch = tty && (values.watch === true || values.watch === undefined);
	const started = rt.now();
	let state = await snapshot(selected, owner, rt);
	if (next(state, tty) !== "Ready") await maybeOpen(rt.home, owner, url, rt);
	for (;;) {
		const frame = render(state, rt);
		if (watch) rt.writeStatus?.(`\x1b[2J\x1b[H${frame}\n`);
		else rt.out(frame);
		if (next(state, tty) === "Ready" || !watch || rt.now() - started >= 900_000)
			break;
		await (rt.sleep ?? Bun.sleep)(5000);
		state = await snapshot(selected, owner, rt);
	}
	if (watch) rt.out(render(state, rt));
	if (next(state, tty) === "Ready") {
		await home({ offline: true }, rt);
		const cap = state.cap?.toLocaleString("en-US") ?? "unknown";
		rt.out(
			`Ready · ${state.venues.filter((venue) => venue.ready).length} venues bound · key ${state.prefix} · cap ${cap === "unknown" ? "unknown" : `$${cap}`}`,
		);
	}
	rt.out(next(state, tty));
}
