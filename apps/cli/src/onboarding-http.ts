import {
	ApiError,
	type Fetch,
	limitHost,
	MobiusClient,
	splitHlSignature,
	type WriteRoutes,
} from "@mstack/mobius-client";
import type { Json, JsonObject, Proposal } from "@mstack/proposals";
import type { Hex } from "viem";
import pkg from "../package.json";
import type { Runtime } from "./commands/runtime.ts";

export function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Expected object response");
	return value as Record<string, unknown>;
}
export function textField(
	value: unknown,
	key: string,
	lineBreaks = false,
): string {
	const v = object(value)[key];
	if (
		typeof v !== "string" ||
		!v ||
		/[\p{Cc}\p{Cf}]/u.test(lineBreaks ? v.replaceAll("\n", "") : v)
	)
		throw new Error(`Invalid ${key}`);
	return v;
}
export async function request(
	fetch: Fetch,
	url: string,
	method: "GET" | "POST",
	body?: JsonObject | URLSearchParams,
	signal = AbortSignal.timeout(30_000),
): Promise<Json> {
	await limitHost(new URL(url).host, signal);
	signal.throwIfAborted();
	const response = await fetch(url, {
		method,
		signal,
		redirect: "error",
		headers: {
			accept: "application/json",
			"X-Mobius-Client": `mstack/${pkg.version}`,
			"User-Agent": `mstack/${pkg.version}`,
			...(body
				? {
						"Content-Type":
							body instanceof URLSearchParams
								? "application/x-www-form-urlencoded"
								: "application/json",
					}
				: {}),
		},
		...(body
			? {
					body:
						body instanceof URLSearchParams
							? body.toString()
							: JSON.stringify(body),
				}
			: {}),
	});
	const raw = await response.text();
	let data: Json;
	try {
		data = JSON.parse(raw);
	} catch {
		throw new ApiError(
			`HTTP ${response.status}: malformed JSON: ${raw.slice(0, 240)}`,
			response.status,
			raw,
		);
	}
	if (!response.ok)
		throw new ApiError(
			`HTTP ${response.status}: ${raw}`,
			response.status,
			data,
		);
	return data;
}
export async function submitPlan(
	p: Proposal,
	body: JsonObject,
	rt: Runtime,
): Promise<Json> {
	const signal = AbortSignal.timeout(Math.max(1, p.expiresAt - rt.now()));
	if (!p.submit.format)
		return (await new MobiusClient({
			base: p.submit.base,
			version: pkg.version,
			fetch: rt.fetch,
		}).write(
			p.submit.route as keyof WriteRoutes,
			body as WriteRoutes[keyof WriteRoutes]["body"],
			signal,
		)) as Json;
	let wire: JsonObject | URLSearchParams;
	const signature = body.signature as Hex;
	if (p.submit.format === "hl")
		wire = { ...p.submit.body, signature: splitHlSignature(signature) };
	else if (p.submit.format === "aster") {
		if (!p.submit.fieldOrder) throw new Error("Aster form order missing");
		wire = new URLSearchParams(
			p.submit.fieldOrder
				.filter((key) => key !== "signatureChainId")
				.map((key) => [key, String(p.submit.body[key])]),
		);
		wire.set("signature", signature);
		wire.set("signatureChainId", String(p.submit.body.signatureChainId));
	} else
		wire = new URLSearchParams({
			tx_type: "8",
			tx_info: JSON.stringify({
				...object(p.submit.body.tx_info),
				L1Sig: signature,
			}),
		});
	const answer = await request(
		rt.fetch,
		`${p.submit.base}${p.submit.route}`,
		"POST",
		wire,
		signal,
	);
	let a: Record<string, unknown>;
	try {
		a = object(answer);
	} catch {
		throw new ApiError(
			`Malformed venue answer: ${JSON.stringify(answer)}`,
			400,
			answer,
		);
	}
	if (
		(p.submit.format === "hl" && a.status !== "ok") ||
		(p.submit.format === "lighter" && a.code !== 200) ||
		(p.submit.format === "aster" &&
			(a.success === false ||
				Object.hasOwn(a, "error") ||
				!(a.code === 200 || (a.code === undefined && a.success === true))))
	)
		throw new ApiError(`Venue refused: ${JSON.stringify(answer)}`, 400, answer);
	const c = p.submit.completion;
	if (!c) return answer;
	const receipt: JsonObject = { venue: answer };
	try {
		const client = new MobiusClient({
			base: c.base,
			version: pkg.version,
			fetch: rt.fetch,
		});
		for (;;) {
			if (rt.now() >= p.expiresAt)
				throw new Error(
					"Proposal expired while waiting for binding confirmation",
				);
			const status = await client.read(
				c.statusRoute,
				{ sessionId: c.sessionId },
				signal,
			);
			receipt.binding = status as unknown as Json;
			if (status.status === "failed")
				throw new Error(`Binding failed: ${status.error ?? "server refused"}`);
			if (status.status === "bound") break;
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => {
					signal.removeEventListener("abort", abort);
					resolve();
				}, 1000);
				function abort() {
					clearTimeout(timer);
					reject(signal.reason);
				}
				if (signal.aborted) abort();
				else signal.addEventListener("abort", abort, { once: true });
			});
		}
		if (rt.now() >= p.expiresAt)
			throw new Error("Proposal expired before builder finalization");
		if (c.finalize)
			receipt.finalize = (await client.write(
				c.finalize.route,
				c.finalize.body,
				signal,
			)) as unknown as Json;
		return receipt;
	} catch (error) {
		if (error instanceof ApiError) receipt.errorAnswer = error.data as Json;
		throw new ApiError(
			error instanceof Error ? error.message : String(error),
			error instanceof ApiError ? error.status : 408,
			receipt,
		);
	}
}
