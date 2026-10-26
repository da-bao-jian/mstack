import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { verifyApiKey } from "@mstack/keys";
import { MobiusClient } from "@mstack/mobius-client";
import { CeremonyStore } from "@mstack/proposals";
import { openSuppressed, openUrl } from "@mstack/signers";
import { getAddress } from "viem";
import pkg from "../package.json";
import type { Runtime as CommandRuntime } from "./commands/runtime.ts";
import {
	getConfig,
	ownerAddress,
	readConfig,
	setConfig,
	UsageError,
	unsetConfig,
} from "./config.ts";
import { paint } from "./format.ts";
import { home } from "./home.ts";
import { cliKeyStore, keyFor } from "./key-store.ts";
import type { Runtime } from "./run.ts";

const venuesAllowed = ["hl", "lighter", "aster", "lighter-mainnet"] as const;
export type OnboardingVenue = (typeof venuesAllowed)[number];
type Readiness = {
	venue: OnboardingVenue;
	bound: boolean;
	ready: boolean;
	issue?: string;
};

// Shown only while no key is stored.
const handoff = [
	"Copy the key from the page. In a chat, paste it there; the agent stores it with `mob keys import --stdin` and never prints it again.",
	"In a terminal, run `mob keys import` and paste it at the hidden prompt.",
];

/** Without --venues, check the stored key's venues, else every venue. */
async function selectedVenues(
	value: unknown,
	owner: string,
	rt: CommandRuntime,
): Promise<OnboardingVenue[]> {
	if (value !== undefined) return venuesFlag(value);
	const stored = (await (await cliKeyStore(rt)).describe(owner))?.meta.venues;
	return stored?.length &&
		stored.every((venue) => venuesAllowed.some((item) => item === venue))
		? (stored as OnboardingVenue[])
		: [...venuesAllowed];
}

function venuesFlag(value: unknown): OnboardingVenue[] {
	const venues = String(value)
		.split(",")
		.map((item) => item.trim()) as OnboardingVenue[];
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

function readiness(value: unknown, selected: OnboardingVenue[]): Readiness[] {
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

export type OnboardingSnapshot = {
	legal: boolean;
	legalError?: string;
	venues: Readiness[];
	key: "none" | "ok" | "rejected" | "unreachable";
	prefix?: string;
	cap?: number;
};

async function snapshot(
	selected: OnboardingVenue[],
	owner: string,
	rt: CommandRuntime,
): Promise<OnboardingSnapshot> {
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
		keyFor(stored, strategyApiBase),
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

function render(state: OnboardingSnapshot, rt: Runtime): string {
	const ok = (text: string) => paint(text, "success", rt);
	const warning = (text: string) => paint(text, "warning", rt);
	const danger = (text: string) => paint(text, "danger", rt);
	const width =
		Math.max(
			...["Legal", ...state.venues.map((row) => row.venue)].map(
				(label) => label.length,
			),
		) + 2;
	const label = (text: string) => text.padEnd(width);
	const lines = [
		`${label("Legal")}${state.legal ? ok("✓ accepted") : danger(`✗ missing${state.legalError ? ` · ${state.legalError}` : ""}`)}`,
		...state.venues.map((row) => {
			if (row.ready) return `${label(row.venue)}${ok("✓ bound")}`;
			if (row.bound)
				return `${label(row.venue)}${danger(`✗ needs repair${row.issue ? ` · ${row.issue}` : ""}`)}`;
			return `${label(row.venue)}${warning(`– not bound${row.issue && row.issue !== "not_bound" ? ` · ${row.issue}` : ""}`)}`;
		}),
		state.key === "none"
			? `${label("Key")}${warning("– none")}`
			: state.key === "ok"
				? `${label("Key")}${ok(`✓ verified ok · ${state.prefix}`)}`
				: `${label("Key")}${danger(`✗ stored ${state.prefix} · ${state.key}`)}`,
		...(state.key === "none" ? handoff : []),
	];
	return lines.join("\n");
}

function next(state: OnboardingSnapshot, tty: boolean): string {
	const incomplete = state.venues.find((venue) => !venue.ready);
	if (incomplete) return `Next: bind ${incomplete.venue} on the page`;
	if (state.key === "unreachable")
		return "Next: the MoB Strategy API did not answer; run mob onboard again in a minute";
	if (state.key !== "ok")
		return tty ? "Next: mob keys import" : "Next: paste the key in the chat";
	return "Ready";
}

/** A line from the human's terminal; the agent's shell has no TTY. */
async function ask(question: string): Promise<string> {
	const terminal = createInterface({
		input: process.stdin,
		crlfDelay: Infinity,
		terminal: false,
	});
	try {
		process.stderr.write(`${question}: `);
		const line = await terminal[Symbol.asyncIterator]().next();
		return line.done ? "" : line.value;
	} finally {
		terminal.close();
	}
}

export async function onboardingStatus(
	options: { owner?: string; venues?: string[] },
	rt: CommandRuntime,
) {
	const config = await readConfig(rt.home);
	const configuredOwner = options.owner ?? config.owner;
	// A fresh install is a normal state, not an error.
	if (!configuredOwner)
		return {
			owner: null,
			ready: false,
			next: "Not set up. Research needs no account. To trade, run mob onboard in a terminal.",
		};
	const owner = getAddress(ownerAddress(configuredOwner));
	const selected = await selectedVenues(options.venues?.join(","), owner, rt);
	const state = await snapshot(selected, owner, rt);
	return {
		owner,
		...state,
		ready: next(state, false) === "Ready",
		next: next(state, false),
	};
}

export async function onboard(
	values: Record<string, string | boolean | undefined>,
	rt: Runtime,
): Promise<void> {
	const current = await readConfig(rt.home);
	let owner = typeof values.owner === "string" ? values.owner : current.owner;
	if (!owner) {
		if (!rt.stdinIsTTY)
			throw new UsageError(
				"mob onboard needs your public wallet address: run it again with --owner 0x…",
			);
		owner = (
			await (rt.prompt ?? ask)(
				"Your wallet address (public, starts with 0x)",
				"",
			)
		).trim();
		if (!owner)
			throw new UsageError(
				"mob onboard needs your public wallet address (it starts with 0x)",
			);
	}
	ownerAddress(owner);
	owner = getAddress(owner);
	await setConfig("owner", owner, rt.home);
	if (typeof values["app-base"] === "string")
		await setConfig("app_base", values["app-base"], rt.home);
	if (values.native === true) {
		const { nativeOnboard } = await import("./ceremony-command.ts");
		try {
			await nativeOnboard(values, rt);
		} catch (error) {
			// A stop before anything is staged leaves the saved owner as it was.
			if (current.owner !== owner && !(await staged(owner, rt)))
				await (current.owner
					? setConfig("owner", current.owner, rt.home)
					: unsetConfig("owner", rt.home));
			throw error;
		}
		return;
	}
	const config = await readConfig(rt.home);
	const appBase = String(getConfig(config, "app_base"));
	const url = `${appBase}/?nav=api`;
	rt.out(`Open ${url}`);
	const selected = await selectedVenues(values.venues, owner, rt);
	const tty = Boolean(rt.stdinIsTTY && rt.stdoutIsTTY);
	const watch = tty && (values.watch === true || values.watch === undefined);
	const started = rt.now();
	let state = await snapshot(selected, owner, rt);
	if (next(state, tty) !== "Ready") await maybeOpen(rt.home, owner, url, rt);
	for (;;) {
		const frame = render(state, rt);
		// A redraw clears the screen, so each frame repeats the page link.
		if (watch) rt.writeStatus?.(`\x1b[2J\x1b[HOpen ${url}\n${frame}\n`);
		else rt.out(frame);
		if (next(state, tty) === "Ready" || !watch || rt.now() - started >= 900_000)
			break;
		await (rt.sleep ?? Bun.sleep)(5000);
		state = await snapshot(selected, owner, rt);
	}
	if (watch) rt.out(render(state, rt));
	if (next(state, tty) !== "Ready") {
		rt.out(next(state, tty));
		return;
	}
	const bound = state.venues.filter((venue) => venue.ready);
	await home(
		{ suppressKeyLegal: true, readyVenues: bound.map((venue) => venue.venue) },
		rt,
	);
	const cap = state.cap?.toLocaleString("en-US");
	rt.out(
		`Ready · ${bound.length} ${bound.length === 1 ? "venue" : "venues"} bound · key ${state.prefix} · cap ${cap === undefined ? "unknown" : `$${cap}`}`,
	);
}

/** Whether this owner has a ceremony that is still open to sign. */
async function staged(owner: string, rt: Runtime): Promise<boolean> {
	return (await new CeremonyStore(rt.home, rt.now, rt.err).list()).some(
		(ceremony) =>
			getAddress(ceremony.owner) === owner &&
			!["complete", "partial", "rejected", "failed", "expired"].includes(
				ceremony.status,
			),
	);
}
