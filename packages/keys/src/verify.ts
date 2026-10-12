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
		const response = await fetch(
			`${apiBase.replace(/\/$/, "")}/v1/delta-neutral/tasks?limit=1`,
			{
				method: "GET",
				redirect: "error",
				headers: {
					accept: "application/json",
					authorization: `Bearer ${secret}`,
				},
				signal: AbortSignal.timeout(30_000),
			},
		);
		const latencyMs = Math.max(0, now() - started);
		if (response.status === 200) return { status: "ok", latencyMs };
		return { status: "rejected", latencyMs, httpStatus: response.status };
	} catch (error) {
		return {
			status: "unreachable",
			error: redactKey(error instanceof Error ? error.message : String(error)),
		};
	}
}
