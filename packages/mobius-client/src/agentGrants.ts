// Session grants, PRD section 6.6: the owner signs one text message that lets
// a locally generated agent key sign scoped mutations under server-enforced
// caps. These builders define the proposed wire contract; the server side is
// PRD roadmap item 9 and does not exist yet.
import type { ArbitrageVenue } from "./types.ts";

export const AGENT_GRANT_SCOPES = [
	"open",
	"resize",
	"neutralize",
	"protect",
	"autoclose",
	"close",
] as const;
export type AgentGrantScope = (typeof AGENT_GRANT_SCOPES)[number];

export interface AgentGrantBody {
	owner: string;
	agent: string;
	scopes: AgentGrantScope[];
	maxOpenNotionalUsd: number;
	maxOpenTasks: number;
	venues: ArbitrageVenue[];
	/** "*" or an explicit list of base assets (BTC, NVDA), never venue market strings. */
	markets: string[] | "*";
	/** Unix seconds. */
	expires: number;
	nonce: string;
	timestamp: number;
}

export interface AgentGrantRevokeBody {
	owner: string;
	agent: string;
	timestamp: number;
}

export interface AgentGrantRecord {
	grantId: string;
	owner: string;
	agent: string;
	scopes: AgentGrantScope[];
	maxOpenNotionalUsd: number;
	maxOpenTasks: number;
	venues: ArbitrageVenue[];
	markets: string[] | "*";
	expiresAt: string;
	revokedAt: string | null;
}

const address = /^0x[0-9a-fA-F]{40}$/;
const uuid =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const venues = new Set(["hl", "lighter", "lighter-mainnet", "aster"]);

export function validateAgentGrantBody(body: AgentGrantBody): void {
	if (!address.test(body.owner))
		throw new Error("grant owner must be an address");
	if (!address.test(body.agent))
		throw new Error("grant agent must be an address");
	if (
		!body.scopes.length ||
		new Set(body.scopes).size !== body.scopes.length ||
		body.scopes.some((scope) => !AGENT_GRANT_SCOPES.includes(scope))
	)
		throw new Error(
			`grant scopes must be unique and among ${AGENT_GRANT_SCOPES.join(", ")}`,
		);
	if (!Number.isFinite(body.maxOpenNotionalUsd) || body.maxOpenNotionalUsd <= 0)
		throw new Error("grant maxOpenNotionalUsd must be positive");
	if (!Number.isSafeInteger(body.maxOpenTasks) || body.maxOpenTasks <= 0)
		throw new Error("grant maxOpenTasks must be a positive integer");
	if (
		!body.venues.length ||
		new Set(body.venues).size !== body.venues.length ||
		body.venues.some((venue) => !venues.has(venue))
	)
		throw new Error("grant venues must be unique execution venues");
	if (
		body.markets !== "*" &&
		(!body.markets.length ||
			new Set(body.markets).size !== body.markets.length ||
			body.markets.some(
				(market) => !/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(market),
			))
	)
		throw new Error(
			'grant markets must be "*" or a unique list of bases (no venue prefix)',
		);
	if (!Number.isSafeInteger(body.timestamp) || body.timestamp <= 0)
		throw new Error("grant timestamp must be unix seconds");
	if (!Number.isSafeInteger(body.expires) || body.expires <= body.timestamp)
		throw new Error("grant expires must be after its timestamp");
	if (!uuid.test(body.nonce)) throw new Error("grant nonce must be a UUID");
}

/** Owner-signed text; one line in the server's existing message style. */
export function buildAgentGrantMessage(body: AgentGrantBody): string {
	validateAgentGrantBody(body);
	return `Authorize Mobius agent: agent=${body.agent.toLowerCase()} scopes=${body.scopes.join(",")} maxOpenNotionalUsd=${body.maxOpenNotionalUsd} maxOpenTasks=${body.maxOpenTasks} venues=${body.venues.join(",")} markets=${body.markets === "*" ? "*" : body.markets.join(",")} expires=${body.expires} nonce=${body.nonce} timestamp=${body.timestamp}`;
}

export function buildAgentGrantRevokeMessage(
	body: AgentGrantRevokeBody,
): string {
	if (!address.test(body.owner) || !address.test(body.agent))
		throw new Error("revoke needs owner and agent addresses");
	if (!Number.isSafeInteger(body.timestamp) || body.timestamp <= 0)
		throw new Error("revoke timestamp must be unix seconds");
	return `Revoke Mobius agent: agent=${body.agent.toLowerCase()} timestamp=${body.timestamp}`;
}
