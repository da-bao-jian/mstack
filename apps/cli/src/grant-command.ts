import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	AGENT_GRANT_SCOPES,
	type AgentGrantBody,
	type AgentGrantScope,
	ApiError,
	type ArbitrageVenue,
	buildAgentGrantMessage,
	buildAgentGrantRevokeMessage,
	MobiusClient,
} from "@mstack/mobius-client";
import type { Json, JsonObject, Proposal } from "@mstack/proposals";
import { getAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import pkg from "../package.json";
import {
	getConfig,
	numberFlag,
	readConfig,
	SETUP_FIRST,
	UsageError,
} from "./config.ts";
import { object } from "./onboarding-http.ts";
import { stageOnboarding } from "./onboarding-stage.ts";
import { table } from "./render.ts";
import type { Runtime } from "./run.ts";

/**
 * Session grants (PRD 6.6), client side. The owner signs one text message
 * that authorizes a locally generated agent key under scopes, caps, venues,
 * and an expiry the server enforces. The server routes are PRD roadmap item
 * 9; until they exist, `create` reports that and stages nothing. Agent-signed
 * mutations are not implemented here.
 */

const NOT_SUPPORTED =
	"The Mobius API does not offer agent grants yet (PRD roadmap item 9); nothing was staged.";
const executionVenues = new Set(["hl", "lighter", "lighter-mainnet", "aster"]);

function grantsDirectory(home: string): string {
	return join(home, "grants");
}

interface AgentKey {
	address: `0x${string}`;
	privateKey: Hex;
}

/** The local agent key for an owner; generated once, never printed. */
async function agentKey(home: string, owner: string): Promise<AgentKey> {
	const directory = grantsDirectory(home);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const path = join(directory, `${owner.toLowerCase()}.agent.json`);
	try {
		const raw = JSON.parse(await readFile(path, "utf8")) as Partial<AgentKey>;
		if (
			typeof raw.privateKey !== "string" ||
			!/^0x[0-9a-fA-F]{64}$/.test(raw.privateKey)
		)
			throw new Error(`Invalid agent key record at ${path}`);
		const account = privateKeyToAccount(raw.privateKey as Hex);
		return { address: account.address, privateKey: raw.privateKey as Hex };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const privateKey = generatePrivateKey();
	const account = privateKeyToAccount(privateKey);
	await writeFile(
		path,
		`${JSON.stringify({ address: account.address, privateKey }, null, 2)}\n`,
		{ mode: 0o600 },
	);
	return { address: account.address, privateKey };
}

interface LocalGrant {
	grantId: string;
	owner: string;
	agent: string;
	scopes: string[];
	maxOpenNotionalUsd: number;
	maxOpenTasks: number;
	venues: string[];
	markets: string[] | "*";
	expiresAt: string;
	revokedAt: string | null;
}

async function localGrants(home: string): Promise<LocalGrant[]> {
	const directory = grantsDirectory(home);
	let files: string[];
	try {
		files = await readdir(directory);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const grants: LocalGrant[] = [];
	for (const file of files.filter(
		(name) => name.endsWith(".json") && !name.endsWith(".agent.json"),
	))
		grants.push(
			JSON.parse(await readFile(join(directory, file), "utf8")) as LocalGrant,
		);
	return grants.sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
}

/** Records a server answer after the owner's signature was submitted. */
export async function recordGrantAnswer(
	rt: Runtime,
	p: Proposal,
	answer: Json,
): Promise<void> {
	const directory = grantsDirectory(rt.home);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	if (p.submit.onAnswer === "store-agent-grant") {
		const grant = object(object(answer).grant);
		const grantId = String(grant.grantId);
		if (!/^[\w-]{1,128}$/.test(grantId))
			throw new Error("Grant answer did not contain a valid grantId");
		// The signed body, not the server's answer, says which agent was authorized.
		const agent = getAddress(String(p.submit.body.agent));
		if (getAddress(String(grant.agent)) !== agent)
			throw new Error(
				"The server answered with an agent address you did not sign; nothing was recorded",
			);
		const record: LocalGrant = {
			grantId,
			owner: p.owner,
			agent,
			scopes: (p.submit.body.scopes as string[]).map(String),
			maxOpenNotionalUsd: Number(p.submit.body.maxOpenNotionalUsd),
			maxOpenTasks: Number(p.submit.body.maxOpenTasks),
			venues: (p.submit.body.venues as string[]).map(String),
			markets:
				p.submit.body.markets === "*"
					? "*"
					: (p.submit.body.markets as string[]).map(String),
			expiresAt: new Date(Number(p.submit.body.expires) * 1000).toISOString(),
			revokedAt: null,
		};
		await writeFile(
			join(directory, `${grantId}.json`),
			`${JSON.stringify(record, null, 2)}\n`,
			{ mode: 0o600 },
		);
		return;
	}
	if (p.submit.onAnswer === "revoke-agent-grant") {
		if (object(answer).ok !== true)
			throw new Error(
				"The server did not confirm the revoke (ok was not true); local records are unchanged",
			);
		const agent = getAddress(String(p.submit.body.agent));
		for (const grant of await localGrants(rt.home))
			if (getAddress(grant.agent) === agent && !grant.revokedAt) {
				grant.revokedAt = new Date(rt.now()).toISOString();
				await writeFile(
					join(directory, `${grant.grantId}.json`),
					`${JSON.stringify(grant, null, 2)}\n`,
					{ mode: 0o600 },
				);
			}
	}
}

function list(value: string | undefined, flag: string): string[] {
	if (typeof value !== "string" || !value.trim())
		throw new UsageError(`--${flag} is required`);
	return value.split(",").map((item) => item.trim());
}

export async function grantCommand(
	args: string[],
	values: Record<string, string | boolean | undefined>,
	rt: Runtime,
): Promise<void> {
	const action = args[0];
	if (!["create", "show", "revoke"].includes(action ?? ""))
		throw new UsageError(
			"Usage: mob grant create --scopes a,b --max-notional <usd> --max-tasks <n> --venues a,b [--markets *|BTC,ETH] [--expires-hours N] | mob grant show | mob grant revoke <agent>",
		);
	const config = await readConfig(rt.home);
	if (!config.owner) throw new UsageError(SETUP_FIRST);
	const owner = getAddress(config.owner);
	if (action === "show") {
		if (args.length !== 1) throw new UsageError("Usage: mob grant show");
		const grants = await localGrants(rt.home);
		if (!grants.length) {
			rt.out("No grants. mob grant create stages one for your wallet to sign.");
			return;
		}
		rt.out(
			table(
				[
					"grant",
					"agent",
					"scopes",
					"cap",
					"tasks",
					"venues",
					"expires",
					"revoked",
				],
				grants.map((grant) => [
					grant.grantId,
					grant.agent,
					grant.scopes.join(","),
					`$${grant.maxOpenNotionalUsd}`,
					grant.maxOpenTasks,
					grant.venues.join(","),
					grant.expiresAt,
					grant.revokedAt ?? false,
				]),
			),
		);
		rt.out(
			"The server is authoritative; local records mirror accepted answers.",
		);
		return;
	}
	const base = String(getConfig(config, "api_base"));
	const client = new MobiusClient({
		base,
		version: pkg.version,
		fetch: rt.fetch,
	});
	const timestamp = Math.floor(rt.now() / 1000);
	// Probe first: the route set is PRD roadmap item 9 and may not exist yet.
	const probe = async () => {
		try {
			await client.read("/api/agent-grants", { owner });
		} catch (error) {
			if (error instanceof ApiError && error.status === 404)
				throw new UsageError(NOT_SUPPORTED);
			throw error;
		}
	};
	if (action === "revoke") {
		if (args.length !== 2 || !/^0x[0-9a-fA-F]{40}$/.test(args[1]))
			throw new UsageError("Usage: mob grant revoke <agent address>");
		const agent = getAddress(args[1]);
		await probe();
		const body = { owner, agent, timestamp };
		await stageOnboarding(
			{
				kind: "sign-text",
				owner,
				purpose: `Revoke agent ${agent}; every later agent-signed mutation fails`,
				signing: { type: "text", message: buildAgentGrantRevokeMessage(body) },
				submit: {
					base,
					route: "/api/agent-grants/revoke",
					body,
					signatureField: "signature",
					onAnswer: "revoke-agent-grant",
				},
				preflightPlan: {
					checks: [
						{ route: "staged", name: "grant.revoke", detail: `agent ${agent}` },
					],
				},
			},
			rt,
		);
		return;
	}
	if (args.length !== 1) throw new UsageError("Usage: mob grant create …");
	const scopes = list(
		values.scopes as string | undefined,
		"scopes",
	) as AgentGrantScope[];
	for (const scope of scopes)
		if (!AGENT_GRANT_SCOPES.includes(scope))
			throw new UsageError(
				`Unknown scope ${scope}; use ${AGENT_GRANT_SCOPES.join(", ")}`,
			);
	if (new Set(scopes).size !== scopes.length)
		throw new UsageError("--scopes must not repeat a scope");
	const venues = list(
		values.venues as string | undefined,
		"venues",
	) as ArbitrageVenue[];
	for (const venue of venues)
		if (!executionVenues.has(venue))
			throw new UsageError(
				`Unknown venue ${venue}; use hl, lighter, lighter-mainnet, aster`,
			);
	if (new Set(venues).size !== venues.length)
		throw new UsageError("--venues must not repeat a venue");
	const maxOpenNotionalUsd = numberFlag(
		typeof values["max-notional"] === "string" ? values["max-notional"] : "",
		"max-notional",
		1,
	);
	const maxOpenTasks = numberFlag(
		typeof values["max-tasks"] === "string" ? values["max-tasks"] : "",
		"max-tasks",
		1,
	);
	if (!Number.isInteger(maxOpenTasks))
		throw new UsageError("--max-tasks must be an integer");
	const hours = numberFlag(
		typeof values["expires-hours"] === "string"
			? values["expires-hours"]
			: "24",
		"expires-hours",
		1,
	);
	if (hours > 24 * 30)
		throw new UsageError("--expires-hours must be at most 720");
	// PRD 6.6 lists base assets, not venue market strings such as xyz:NVDA.
	const markets =
		values.markets === undefined || values.markets === "*"
			? "*"
			: list(values.markets as string, "markets");
	if (markets !== "*") {
		for (const market of markets)
			if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(market))
				throw new UsageError(
					`--markets takes base assets such as BTC or NVDA, not venue market strings (${market})`,
				);
		if (new Set(markets).size !== markets.length)
			throw new UsageError("--markets must not repeat a base");
	}
	await probe();
	const key = await agentKey(rt.home, owner);
	const body: AgentGrantBody = {
		owner,
		agent: key.address,
		scopes,
		maxOpenNotionalUsd,
		maxOpenTasks,
		venues,
		markets,
		expires: timestamp + Math.round(hours * 3600),
		nonce: crypto.randomUUID(),
		timestamp,
	};
	const message = buildAgentGrantMessage(body);
	await stageOnboarding(
		{
			kind: "sign-text",
			owner,
			purpose: `Authorize agent ${key.address} · ${scopes.join(", ")} · cap $${maxOpenNotionalUsd} across ${maxOpenTasks} task(s) · ${venues.join(", ")} · markets ${markets === "*" ? "any" : markets.join(", ")} · until ${new Date(body.expires * 1000).toISOString()}`,
			signing: { type: "text", message },
			submit: {
				base,
				route: "/api/agent-grants/create",
				body: body as unknown as JsonObject,
				signatureField: "signature",
				onAnswer: "store-agent-grant",
			},
			preflightPlan: {
				checks: [
					{
						route: "staged",
						name: "grant.scope",
						detail:
							"The agent key can never bind a venue, approve a builder fee, deposit, withdraw, or create or extend a grant; the server rejects those routes for agent signatures.",
					},
				],
			},
		},
		rt,
	);
}
