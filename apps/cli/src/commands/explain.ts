import { explain as knowledge } from "../knowledge.ts";
import type { Runtime } from "./runtime.ts";

export async function explain(
	options: { topic?: string; simple?: boolean },
	_rt: Runtime,
): Promise<string> {
	return knowledge(options.topic, options.simple === true);
}
