import {
	isApiKey,
	type KeyMeta,
	prefixOf,
	redactKey,
	verifyApiKey,
} from "@mstack/keys";
import { apiKeyMessage, MobiusClient } from "@mstack/mobius-client";
import type { JsonObject, ProposalInput } from "@mstack/proposals";
import { readSecretFromTty, type SecretReader } from "@mstack/signers";
import { getAddress } from "viem";
import pkg from "../package.json";
import {
	getConfig,
	numberFlag,
	readConfig,
	SETUP_FIRST,
	UsageError,
} from "./config.ts";
import { cliKeyStore } from "./key-store.ts";
import { object } from "./onboarding-http.ts";
import { stageOnboarding } from "./onboarding-stage.ts";
import { table } from "./render.ts";
import type { Runtime } from "./run.ts";

const venuesAllowed = new Set(["hl", "aster", "lighter", "lighter-mainnet"]);
const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type KeyAction = "create" | "list" | "revoke";

function cleanName(value: string): string {
	const name = value.trim();
	if (!name || name.length > 64 || /[\p{Cc}\p{Cf}]/u.test(name))
		throw new UsageError("name must be 1 to 64 visible characters");
	return name;
}

function parseVenues(value: string, minimum = 1): string[] {
	const venues = value.split(",").map((item) => item.trim());
	if (
		venues.length < minimum ||
		venues.length > 4 ||
		new Set(venues).size !== venues.length ||
		venues.some((venue) => !venuesAllowed.has(venue))
	)
		throw new UsageError(
			`venues must contain ${minimum} to 4 unique values: hl, aster, lighter, lighter-mainnet`,
		);
	return venues;
}

async function optionalAnswers(
	values: Record<string, string | boolean | undefined>,
	rt: Runtime,
	read: SecretReader,
	promptMissing: boolean,
): Promise<Pick<KeyMeta, "name" | "venues" | "maxSizeUsd">> {
	const ask = rt.prompt
		? async (question: string) =>
				(await rt.prompt?.(question, ""))?.trim() ?? ""
		: async (question: string) =>
				(await read(`${question} (optional): `)).trim();
	const nameRaw =
		typeof values.name === "string"
			? values.name
			: promptMissing
				? await ask("Key name")
				: "";
	const venuesRaw =
		typeof values.venues === "string"
			? values.venues
			: promptMissing
				? await ask("Venues (comma-separated)")
				: "";
	const maxRaw =
		typeof values["max-size"] === "string"
			? values["max-size"]
			: promptMissing
				? await ask("Maximum USD per leg")
				: "";
	return {
		...(nameRaw ? { name: cleanName(nameRaw) } : {}),
		...(venuesRaw ? { venues: parseVenues(venuesRaw) } : {}),
		...(maxRaw ? { maxSizeUsd: numberFlag(maxRaw, "maxSizeUsd", 10) } : {}),
	};
}

async function importKey(
	values: Record<string, string | boolean | undefined>,
	rt: Runtime,
	read: SecretReader,
) {
	const config = await readConfig(rt.home);
	if (!config.owner) throw new UsageError(SETUP_FIRST);
	const store = await cliKeyStore(rt);
	rt.out(`Key store: ${store.backend}`);
	if (store.backend === "env")
		throw new UsageError("MOBIUS_API_KEY is already set and is read-only");
	let secret: string;
	if (values.stdin === true) {
		const input = await (rt.readStdin?.() ?? Bun.stdin.text());
		secret = input.trim();
		if (/[\r\n]/.test(secret))
			throw new UsageError("stdin must contain exactly one key line");
	} else
		try {
			secret = (await read("Mobius API key: ")).trim();
		} catch (error) {
			throw new UsageError(
				`${error instanceof Error ? error.message : String(error)}. Use --stdin for agent-mediated import. MOBIUS_API_KEY is only a read-only runtime override.`,
			);
		}
	if (!isApiKey(secret))
		throw new UsageError("Invalid Mobius API key format; not stored");
	const apiBase = String(getConfig(config, "strategy_api_base"));
	const checked = await verifyApiKey(apiBase, secret, rt.fetch, rt.now);
	if (checked.status === "rejected" && checked.httpStatus === 401)
		throw new UsageError("key rejected by the API, not stored");
	if (checked.status !== "ok" && values.unverified !== true)
		throw new UsageError(
			"could not verify; not stored (use --unverified to store anyway)",
		);
	if (checked.status !== "ok")
		rt.out("Warning: storing an unverified API key.");
	const details = await optionalAnswers(
		values,
		rt,
		read,
		values.stdin !== true,
	);
	const meta: KeyMeta = {
		...details,
		importedAt: rt.now(),
		...(checked.status === "ok" ? { verifiedAt: rt.now() } : {}),
		apiBase,
	};
	await store.put(config.owner, secret, meta);
	const prefix = prefixOf(secret);
	rt.out(`Key ${prefix} stored in ${store.backend}.`);
}

function readinessRows(value: unknown): Record<string, unknown>[] {
	if (Array.isArray(value)) return value.map(object);
	const root = object(value);
	const rows = root.venues ?? root.readiness;
	if (!Array.isArray(rows))
		throw new Error("Binding readiness response has no venue list");
	return rows.map(object);
}

async function requireReadiness(
	base: string,
	owner: string,
	venues: string[],
	rt: Runtime,
): Promise<string> {
	const result = await new MobiusClient({
		base,
		version: pkg.version,
		fetch: rt.fetch,
	}).read("/api/binding/readiness", { ownerAddress: owner });
	const rows = readinessRows(result);
	for (const venue of venues) {
		const row = rows.find((item) => item.venue === venue);
		if (!row || !(row.bound === true || row.ready === true))
			throw new UsageError(
				`${venue} is not bound; key creation preflight failed`,
			);
	}
	return `${venues.join(", ")} bound`;
}

async function stage(
	action: KeyAction,
	args: string[],
	values: Record<string, string | boolean | undefined>,
	rt: Runtime,
) {
	const config = await readConfig(rt.home);
	if (!config.owner) throw new UsageError(SETUP_FIRST);
	const owner = getAddress(config.owner);
	const base = String(getConfig(config, "api_base"));
	const timestamp = Math.floor(rt.now() / 1000);
	let body: JsonObject = { owner, timestamp };
	let purpose: string;
	let readiness: string | undefined;
	if (action === "create") {
		if (args.length)
			throw new UsageError(
				"Usage: mob keys create --name <n> --venues a,b[,c,d] --max-size <usd>",
			);
		if (
			typeof values.name !== "string" ||
			typeof values.venues !== "string" ||
			typeof values["max-size"] !== "string"
		)
			throw new UsageError(
				"keys create requires --name, --venues, and --max-size",
			);
		const name = cleanName(values.name);
		const venues = parseVenues(values.venues, 2);
		const maxSizeUsd = numberFlag(values["max-size"], "max-size", 10);
		if (
			maxSizeUsd > 1_000_000_000 ||
			Math.round(maxSizeUsd * 1_000_000) / 1_000_000 !== maxSizeUsd
		)
			throw new UsageError(
				"max-size must be at most 1000000000 with at most 6 decimals",
			);
		readiness = await requireReadiness(base, owner, venues, rt);
		body = {
			owner,
			name,
			venues,
			maxSizeUsd,
			nonce: crypto.randomUUID(),
			timestamp,
		};
		purpose = `Create API key “${name}” · venues ${venues.join(", ")} · cap $${maxSizeUsd}`;
	} else if (action === "list") {
		if (args.length) throw new UsageError("Usage: mob keys list");
		purpose =
			"Read API key records only; this signature cannot create, revoke, or trade";
	} else {
		if (args.length !== 1 || !uuidPattern.test(args[0]))
			throw new UsageError("Usage: mob keys revoke <uuid>");
		body = { owner, id: args[0], timestamp };
		purpose = `Revoke API key mobius_${args[0]}…`;
	}
	const input: ProposalInput = {
		kind: "sign-text",
		owner,
		purpose,
		signing: {
			type: "text",
			message: apiKeyMessage(action, {
				owner: String(body.owner),
				timestamp: Number(body.timestamp),
				...(action === "create"
					? {
							name: String(body.name),
							venues: body.venues as (
								| "aster"
								| "hl"
								| "lighter"
								| "lighter-mainnet"
							)[],
							maxSizeUsd: Number(body.maxSizeUsd),
							nonce: String(body.nonce),
						}
					: action === "revoke"
						? { id: String(body.id) }
						: {}),
			}),
		},
		submit: {
			base,
			route: `/api/keys/${action}`,
			body,
			signatureField: "signature",
			...(action === "create" ? { onAnswer: "store-api-key" as const } : {}),
		},
		preflightPlan: {
			checks: [
				{
					route: "staged",
					name: action === "create" ? "binding.readiness" : "key.operation",
					detail:
						readiness ??
						(action === "list" ? "Read-only key list" : `Revoke ${args[0]}`),
				},
			],
		},
	};
	return stageOnboarding(input, rt);
}

export function keyListTable(answer: unknown): string {
	const root = Array.isArray(answer) ? answer : object(answer).keys;
	if (!Array.isArray(root)) throw new Error("Invalid key list response");
	return table(
		["prefix", "name", "venues", "cap", "created", "revoked"],
		root.map((item) => {
			const row = object(item);
			const prefix =
				typeof row.key_prefix === "string"
					? redactKey(row.key_prefix)
					: typeof row.id === "string"
						? `mobius_${row.id}…`
						: "—";
			return [
				prefix,
				row.name ?? "—",
				Array.isArray(row.venues) ? row.venues.join(",") : "—",
				row.max_size_usd ?? "—",
				row.created_at ?? "—",
				row.revoked_at ?? false,
			];
		}),
	);
}

export async function keysCommand(
	args: string[],
	values: Record<string, string | boolean | undefined>,
	rt: Runtime,
	read: SecretReader = readSecretFromTty,
) {
	const [action, ...rest] = args;
	if (
		!action ||
		!["import", "create", "list", "revoke", "show", "delete"].includes(action)
	)
		throw new UsageError(
			"Usage: mob keys import|create|list|revoke|show|delete",
		);
	if (action === "import") {
		if (rest.length)
			throw new UsageError(
				"pass the key on stdin or type it at the prompt; never on the command line",
			);
		if (values["from-env"] === true)
			throw new UsageError(
				"MOBIUS_API_KEY is a read-only runtime override; --from-env is not supported",
			);
		return importKey(values, rt, read);
	}
	if (action === "create" || action === "list" || action === "revoke")
		return stage(action, rest, values, rt);
	if (rest.length) throw new UsageError(`Usage: mob keys ${action}`);
	const config = await readConfig(rt.home);
	if (!config.owner) throw new UsageError(SETUP_FIRST);
	const store = await cliKeyStore(rt);
	if (action === "delete") {
		const removed = await store.delete(config.owner);
		rt.out(
			`${removed ? "Local key deleted." : "No local key was stored."} The API key still works until it is revoked.`,
		);
		return;
	}
	const description = await store.describe(config.owner);
	if (!description) {
		rt.out(
			values.json
				? JSON.stringify({ key: null }, null, 2)
				: "Key: none · run mob keys import",
		);
		return;
	}
	const stored = await store.get(config.owner);
	if (!stored) throw new Error("Key disappeared during inspection");
	const check = await verifyApiKey(
		description.meta.apiBase,
		stored.key,
		rt.fetch,
		rt.now,
	);
	const result = { ...description, check };
	if (values.json) rt.out(JSON.stringify(result, null, 2));
	else {
		const status =
			check.status === "ok"
				? `ok · ${check.latencyMs} ms`
				: check.status === "rejected"
					? `rejected (${check.httpStatus})`
					: "unreachable";
		rt.out(
			`Key: ${description.prefix} (${description.backend})\nName: ${description.meta.name ?? "—"}\nVenues: ${description.meta.venues?.join(", ") ?? "—"}\nCap: ${description.meta.maxSizeUsd ?? "—"}\nAPI: ${description.meta.apiBase}\nCheck: ${status}`,
		);
	}
}
