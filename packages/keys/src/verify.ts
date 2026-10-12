import { StrategyApiClient, StrategyApiError } from "@mstack/mobius-api";
import pkg from "../package.json";
import { redactKey } from "./format.ts";

export type Verification =
	| { status: "ok"; latencyMs: number }
	| { status: "rejected"; latencyMs: number; httpStatus: number }
	| { status: "unreachable"; error: string };

export type KeyFetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function verifyApiKey(
	apiBase: string,
	secret: string,
	fetch: KeyFetch = globalThis.fetch,
	now: () => number = Date.now,
): Promise<Verification> {
	const started = now();
	try {
		await new StrategyApiClient({
			base: apiBase,
			key: secret,
			version: pkg.version,
			fetch,
			now,
		}).listTasks({ limit: 1 });
		const latencyMs = Math.max(0, now() - started);
		return { status: "ok", latencyMs };
	} catch (error) {
		if (error instanceof StrategyApiError && error.status > 0)
			return {
				status: "rejected",
				latencyMs: Math.max(0, now() - started),
				httpStatus: error.status,
			};
		return {
			status: "unreachable",
			error: redactKey(error instanceof Error ? error.message : String(error)),
		};
	}
}
