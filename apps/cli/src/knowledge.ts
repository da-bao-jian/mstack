import annualization from "../../../docs/knowledge/annualization.md" with {
	type: "text",
};
import autoClose from "../../../docs/knowledge/auto-close.md" with {
	type: "text",
};
import basis from "../../../docs/knowledge/basis.md" with { type: "text" };
import deltaNeutral from "../../../docs/knowledge/delta-neutral.md" with {
	type: "text",
};
import distance from "../../../docs/knowledge/distance-to-liquidation.md" with {
	type: "text",
};
import fees from "../../../docs/knowledge/fees.md" with { type: "text" };
import funding from "../../../docs/knowledge/funding.md" with { type: "text" };
import protection from "../../../docs/knowledge/liquidation-protection.md" with {
	type: "text",
};
import keys from "../../../docs/knowledge/venue-keys.md" with { type: "text" };
import worker from "../../../docs/knowledge/worker.md" with { type: "text" };
import { UsageError } from "./config.ts";

export const knowledge: Readonly<Record<string, string>> = {
	funding,
	basis,
	"delta-neutral": deltaNeutral,
	annualization,
	"distance-to-liquidation": distance,
	"liquidation-protection": protection,
	"auto-close": autoClose,
	fees,
	"venue-keys": keys,
	worker,
};

export function explain(topic: string | undefined, simple: boolean): string {
	const topics = `Topics: ${Object.keys(knowledge).join(", ")}`;
	if (!topic) return topics;
	if (!Object.hasOwn(knowledge, topic))
		throw new UsageError(`Unknown topic ${topic}. ${topics}`);
	const text = knowledge[topic];
	if (!simple) return text.trim();
	return text.split("## Simple\n\n")[1].split("\n\n## Precise")[0].trim();
}
