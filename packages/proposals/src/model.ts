import {
	type ReadRoutes,
	type WriteRoutes,
	writeRoutes,
} from "@mstack/mobius-client";
import {
	type Address,
	getAddress,
	type Hex,
	hashTypedData,
	keccak256,
	stringToHex,
	type TypedDataDefinition,
} from "viem";
export type Json =
	| null
	| boolean
	| number
	| string
	| Json[]
	| { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export type ProposalStatus =
	| "staged"
	| "previewed"
	| "awaiting-signature"
	| "interrupted"
	| "signed"
	| "submitted"
	| "confirmed"
	| "rejected"
	| "failed"
	| "expired";
export type SigningPayload =
	| { type: "text"; message: string }
	| { type: "typed"; typedData: TypedDataDefinition };
export type ReadCheck = {
	[R in keyof ReadRoutes]: {
		route: R;
		name?: string;
		params: ReadRoutes[R]["params"];
		assertions: ({ path: string[] } & (
			| { equals: Json }
			| { remainingMs: number }
		))[];
	};
}[keyof ReadRoutes];
/** Immutable evidence computed before staging; preview never refreshes its inputs. */
export type PreflightCheck =
	| ReadCheck
	| { route: "staged"; name: string; detail: string };
export interface PreflightResult {
	ok: boolean;
	checkedAt: number;
	checks: {
		route: string;
		name?: string;
		detail?: string;
		ok: boolean;
		error?: string;
	}[];
}
export interface ProposalInput {
	kind: "sign-text" | "sign-typed" | "venue-submit";
	owner: Address;
	purpose: string;
	signing: SigningPayload;
	submit: {
		base: string;
		route:
			| keyof WriteRoutes
			| "/api/keys/create"
			| "/api/keys/list"
			| "/api/keys/revoke"
			| "/exchange"
			| "/fapi/v3/approveAgent"
			| "/api/v1/sendTx";
		format?: "hl" | "aster" | "lighter";
		fieldOrder?: string[];
		binding?: {
			venue: "hl" | "aster" | "lighter" | "lighter-mainnet";
			step: string;
			sessionId?: string;
			publicKey?: string;
			apiBase: string;
		};
		completion?: {
			base: string;
			statusRoute:
				| "/api/binding/hl/status"
				| "/api/binding/aster/status"
				| "/api/binding/lighter/status";
			sessionId: string;
			finalize?: {
				route:
					| "/api/binding/hl/builder-finalize"
					| "/api/binding/aster/builder-finalize";
				body: { ownerAddress: string };
			};
		};
		body: JsonObject;
		signatureField: string;
		onAnswer?: "store-api-key";
	};
	preflightPlan: { checks: PreflightCheck[] };
}
export interface Proposal extends ProposalInput {
	version: 1;
	id: string;
	createdAt: number;
	expiresAt: number;
	digest: Hex;
	contentHash: Hex;
	status: ProposalStatus;
	endedAt?: number;
	preflight?: PreflightResult;
	signatureAttemptedAt?: number;
	signature?: Hex;
	answer?: Json;
	error?: string;
}
/** JSON persistence must not change signable numbers, bytes, or typed-data values. */
export function canonical(value: unknown): string {
	if (value === null || typeof value === "boolean" || typeof value === "string")
		return JSON.stringify(value);
	if (
		typeof value === "number" &&
		Number.isFinite(value) &&
		!Object.is(value, -0)
	)
		return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (
		value &&
		typeof value === "object" &&
		Object.getPrototypeOf(value) === Object.prototype
	)
		return `{${Object.keys(value)
			.sort()
			.map(
				(key) =>
					`${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
			)
			.join(",")}}`;
	throw new Error(
		"Proposal must contain only lossless JSON values (use decimal strings for typed-data big integers)",
	);
}
export function digest(signing: SigningPayload): Hex {
	return signing.type === "text"
		? keccak256(stringToHex(signing.message))
		: hashTypedData(signing.typedData);
}
export function contentHash(
	p: ProposalInput & {
		id: string;
		createdAt: number;
		expiresAt: number;
		digest: Hex;
	},
): Hex {
	return keccak256(
		stringToHex(
			canonical({
				kind: p.kind,
				owner: p.owner,
				purpose: p.purpose,
				signing: p.signing,
				submit: p.submit,
				preflightPlan: p.preflightPlan,
				id: p.id,
				createdAt: p.createdAt,
				expiresAt: p.expiresAt,
				digest: p.digest,
			}),
		),
	);
}
export function validateInput(p: ProposalInput): void {
	canonical(p);
	const object = (value: unknown, field: string) => {
		if (!value || typeof value !== "object" || Array.isArray(value))
			throw new Error(`${field}: expected an object`);
	};
	object(p, "Proposal");
	try {
		getAddress(p.owner);
	} catch {
		throw new Error("owner: invalid address");
	}
	object(p.signing, "signing");
	object(p.submit, "submit");
	object(p.submit.body, "submit.body");
	object(p.preflightPlan, "preflightPlan");
	if (!Array.isArray(p.preflightPlan.checks))
		throw new Error("preflightPlan.checks: expected an array");
	if (
		typeof p.purpose !== "string" ||
		!p.purpose ||
		/[\p{Cc}\p{Cf}]/u.test(p.purpose)
	)
		throw new Error("purpose: Invalid Proposal purpose");
	if (!["sign-text", "sign-typed", "venue-submit"].includes(p.kind))
		throw new Error("kind: Invalid Proposal kind");
	if (p.signing.type !== "text" && p.signing.type !== "typed")
		throw new Error("signing.type: Invalid signing payload");
	if (
		(p.kind === "sign-text" && p.signing.type !== "text") ||
		(p.kind === "sign-typed" && p.signing.type !== "typed")
	)
		throw new Error(
			"kind/signing.type: Proposal kind does not match signing payload",
		);
	if (
		p.signing.type === "text" &&
		(typeof p.signing.message !== "string" ||
			!p.signing.message ||
			/[\p{Cc}\p{Cf}]/u.test(
				p.kind === "venue-submit"
					? p.signing.message.replaceAll("\n", "")
					: p.signing.message,
			))
	)
		throw new Error(
			"signing.message: Text message must be nonempty and have no terminal control characters (venue-submit permits line feeds)",
		);
	let base: URL;
	try {
		base = new URL(p.submit.base);
	} catch {
		throw new Error("submit.base: invalid URL");
	}
	if (typeof p.submit.route !== "string")
		throw new Error("submit.route: expected a string");
	if (p.signing.type === "typed") {
		try {
			hashTypedData(p.signing.typedData);
		} catch {
			throw new Error("signing.typedData: invalid typed data");
		}
	}
	if (
		(base.protocol !== "https:" &&
			!(
				base.protocol === "http:" &&
				["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
			)) ||
		base.username ||
		base.password ||
		base.search ||
		base.hash
	)
		throw new Error(
			"submit.base: Submission requires HTTPS (HTTP is allowed only on loopback)",
		);
	if (
		(!Object.hasOwn(writeRoutes, p.submit.route) && !p.submit.format) ||
		p.submit.route.endsWith("/alert-dismiss") ||
		p.submit.route.endsWith("/builder-finalize")
	) {
		if (!/^\/api\/keys\/(create|list|revoke)$/.test(p.submit.route))
			throw new Error("submit.route: Invalid submission route");
	}
	if (
		p.submit.onAnswer !== undefined &&
		(p.submit.onAnswer !== "store-api-key" ||
			p.submit.route !== "/api/keys/create")
	)
		throw new Error("submit.onAnswer: Invalid answer handler");
	const formats = {
		hl: { route: "/exchange", hosts: ["api.hyperliquid.xyz"] },
		aster: { route: "/fapi/v3/approveAgent", hosts: ["fapi.asterdex.com"] },
		lighter: {
			route: "/api/v1/sendTx",
			hosts: ["api.rh.lighter.xyz", "mainnet.zklighter.elliot.ai"],
		},
	};
	if (p.submit.format) {
		const format = formats[p.submit.format];
		if (
			!format ||
			p.submit.route !== format.route ||
			!format.hosts.includes(base.hostname) ||
			base.pathname !== "/" ||
			base.port
		)
			throw new Error("submit.format: Invalid venue submission endpoint");
	}
	if (
		p.submit.format &&
		((p.submit.format === "lighter" &&
			(p.kind !== "venue-submit" || p.signing.type !== "text")) ||
			(p.submit.format !== "lighter" && p.kind !== "sign-typed"))
	)
		throw new Error(
			"submit.format: Venue submission kind does not match signing payload",
		);
	if (p.submit.format === "aster" && !p.submit.fieldOrder)
		throw new Error(
			"submit.fieldOrder: Aster form field order is required at staging",
		);
	if (
		p.submit.fieldOrder &&
		(p.submit.format !== "aster" ||
			new Set(p.submit.fieldOrder).size !== p.submit.fieldOrder.length ||
			canonical([...p.submit.fieldOrder].sort()) !==
				canonical(Object.keys(p.submit.body).sort()))
	)
		throw new Error("submit.fieldOrder: Invalid form field order");
	if (p.submit.completion) {
		const c = p.submit.completion;
		const u = new URL(c.base);
		if (
			u.username ||
			u.password ||
			u.search ||
			u.hash ||
			(u.protocol !== "https:" &&
				!(u.protocol === "http:" && u.hostname === "127.0.0.1"))
		)
			throw new Error(
				"submit.completion.base: Invalid binding completion base",
			);
		const venue = p.submit.format === "lighter" ? "lighter" : p.submit.format;
		if (
			!venue ||
			c.statusRoute !== `/api/binding/${venue}/status` ||
			!c.sessionId ||
			/[\p{Cc}\p{Cf}]/u.test(c.sessionId)
		)
			throw new Error("submit.completion: Invalid binding completion");
		if (
			c.finalize &&
			(venue === "lighter" ||
				c.finalize.route !== `/api/binding/${venue}/builder-finalize` ||
				getAddress(c.finalize.body.ownerAddress) !== getAddress(p.owner))
		)
			throw new Error(
				"submit.completion.finalize: Invalid builder finalization",
			);
	}
	if (
		p.submit.signatureField !== "signature" ||
		Object.hasOwn(p.submit.body, p.submit.signatureField)
	)
		throw new Error(
			"submit.signatureField: Signature field must be empty at staging",
		);
	if (!p.preflightPlan.checks.length)
		throw new Error("preflightPlan: Proposal requires a stored preflight plan");
	for (const check of p.preflightPlan.checks) {
		object(check, "preflightPlan.checks[]");
		if (
			check.name !== undefined &&
			(typeof check.name !== "string" ||
				!check.name ||
				/[\p{Cc}\p{Cf}]/u.test(check.name))
		)
			throw new Error(
				"preflightPlan.checks[].name: Invalid preflight check name",
			);
		if (check.route === "staged") {
			if (
				!check.name ||
				typeof check.detail !== "string" ||
				!check.detail ||
				/[\p{Cc}\p{Cf}]/u.test(check.detail)
			)
				throw new Error(
					"preflightPlan.checks[].detail: Invalid staged preflight evidence",
				);
			continue;
		}
		if (
			!/^\/api\/(arbitrage\/(task|list|rates)|binding\/(rebind-check|(hl|aster|lighter)\/credential))$/.test(
				check.route,
			)
		)
			throw new Error(
				"preflightPlan.checks[].route: Preflight must use a public read without side effects",
			);
		if (
			!Array.isArray(check.assertions) ||
			!check.assertions.length ||
			check.assertions.some(
				(a) =>
					!a ||
					typeof a !== "object" ||
					("remainingMs" in a &&
						(!Number.isSafeInteger(a.remainingMs) || a.remainingMs < 0)) ||
					!Array.isArray(a.path) ||
					!a.path.length ||
					a.path.some((key) =>
						["__proto__", "constructor", "prototype"].includes(key),
					),
			)
		)
			throw new Error(
				"preflightPlan.checks[].assertions: Preflight needs explicit assertions",
			);
	}
}
export function validateProposal(p: Proposal): void {
	validateInput(p);
	if (
		p.version !== 1 ||
		!/^p-[1-9]\d*$/.test(p.id) ||
		!Number.isSafeInteger(p.createdAt) ||
		p.createdAt < 0 ||
		p.expiresAt !== p.createdAt + 300_000 ||
		p.digest !== digest(p.signing) ||
		p.contentHash !== contentHash(p)
	)
		throw new Error(
			"Proposal integrity check failed (version/id/createdAt/expiresAt/signing.digest/contentHash)",
		);
	if (
		![
			"staged",
			"previewed",
			"awaiting-signature",
			"interrupted",
			"signed",
			"submitted",
			"confirmed",
			"rejected",
			"failed",
			"expired",
		].includes(p.status)
	)
		throw new Error("status: Invalid Proposal status");
	if (
		p.endedAt !== undefined &&
		(!Number.isSafeInteger(p.endedAt) || p.endedAt < p.createdAt)
	)
		throw new Error("endedAt: Invalid Proposal end time");
	if (
		p.preflight &&
		(!Array.isArray(p.preflight.checks) ||
			p.preflight.checks.length !== p.preflightPlan.checks.length ||
			!Number.isSafeInteger(p.preflight.checkedAt) ||
			p.preflight.checkedAt < p.createdAt ||
			(p.status !== "expired" && p.preflight.checkedAt >= p.expiresAt) ||
			p.preflight.checks.some(
				(check, i) =>
					check.route !== p.preflightPlan.checks[i].route ||
					check.name !== p.preflightPlan.checks[i].name ||
					typeof check.ok !== "boolean",
			) ||
			p.preflight.ok !== p.preflight.checks.every((check) => check.ok))
	)
		throw new Error("preflight: Invalid preflight result");
}
