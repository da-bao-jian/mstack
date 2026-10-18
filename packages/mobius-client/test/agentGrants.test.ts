import { expect, test } from "bun:test";
import {
	buildAgentGrantMessage,
	buildAgentGrantRevokeMessage,
} from "../src/agentGrants.ts";

const owner = "0xA4e8Ab55b434e5486550eB51b4B314Ec9fb5fBde";
const agent = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const nonce = "01234567-89ab-4cde-8123-456789abcdef";

test("grant and revoke messages are byte-exact per PRD 6.6", () => {
	expect(
		buildAgentGrantMessage({
			owner,
			agent,
			scopes: ["open", "close"],
			maxOpenNotionalUsd: 5000,
			maxOpenTasks: 3,
			venues: ["hl", "lighter"],
			markets: "*",
			expires: 1_800_086_400,
			nonce,
			timestamp: 1_800_000_000,
		}),
	).toBe(
		`Authorize Mobius agent: agent=${agent.toLowerCase()} scopes=open,close maxOpenNotionalUsd=5000 maxOpenTasks=3 venues=hl,lighter markets=* expires=1800086400 nonce=${nonce} timestamp=1800000000`,
	);
	expect(
		buildAgentGrantMessage({
			owner,
			agent,
			scopes: ["protect"],
			maxOpenNotionalUsd: 250.5,
			maxOpenTasks: 1,
			venues: ["aster"],
			markets: ["BTC", "ETH"],
			expires: 1_800_000_001,
			nonce,
			timestamp: 1_800_000_000,
		}),
	).toContain("markets=BTC,ETH expires=1800000001");
	expect(
		buildAgentGrantRevokeMessage({ owner, agent, timestamp: 1_800_000_000 }),
	).toBe(
		`Revoke Mobius agent: agent=${agent.toLowerCase()} timestamp=1800000000`,
	);
});

test.each([
	[{ scopes: [] }, "scopes"],
	[{ scopes: ["open", "open"] }, "scopes"],
	[{ scopes: ["withdraw"] }, "scopes"],
	[{ maxOpenNotionalUsd: 0 }, "maxOpenNotionalUsd"],
	[{ maxOpenTasks: 1.5 }, "maxOpenTasks"],
	[{ venues: ["binance"] }, "venues"],
	[{ markets: [] }, "markets"],
	[{ expires: 1_800_000_000 }, "expires"],
	[{ nonce: "nope" }, "nonce"],
	[{ agent: "0x12" }, "agent"],
])("grant validation rejects %j", (override, word) => {
	expect(() =>
		buildAgentGrantMessage({
			owner,
			agent,
			scopes: ["open"],
			maxOpenNotionalUsd: 100,
			maxOpenTasks: 1,
			venues: ["hl"],
			markets: "*",
			expires: 1_800_000_060,
			nonce,
			timestamp: 1_800_000_000,
			...(override as object),
		} as Parameters<typeof buildAgentGrantMessage>[0]),
	).toThrow(word);
});
