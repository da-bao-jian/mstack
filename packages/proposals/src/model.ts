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
		params: ReadRoutes[R]["params"];
		assertions: { path: string[]; equals: Json }[];
	};
}[keyof ReadRoutes];
export interface PreflightResult {
	ok: boolean;
	checkedAt: number;
	checks: { route: string; ok: boolean; error?: string }[];
}
export interface ProposalInput {
	kind: "sign-text" | "sign-typed" | "venue-submit";
	owner: Address;
	purpose: string;
	signing: SigningPayload;
	submit: {
		base: string;
		route: keyof WriteRoutes;
		body: JsonObject;
		signatureField: string;
	};
	preflightPlan: { checks: ReadCheck[] };
}
export interface Proposal extends ProposalInput {
	version: 1;
	id: string;
	createdAt: number;
	expiresAt: number;
	digest: Hex;
	contentHash: Hex;
	status: ProposalStatus;
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
	getAddress(p.owner);
	if (!p.purpose || /[\p{Cc}\p{Cf}]/u.test(p.purpose))
		throw new Error("Invalid Proposal purpose");
	if (!["sign-text", "sign-typed", "venue-submit"].includes(p.kind))
		throw new Error("Invalid Proposal kind");
	if (p.signing.type !== "text" && p.signing.type !== "typed")
		throw new Error("Invalid signing payload");
	if (
		(p.kind === "sign-text" && p.signing.type !== "text") ||
		(p.kind === "sign-typed" && p.signing.type !== "typed")
	)
		throw new Error("Proposal kind does not match signing payload");
	if (
		p.signing.type === "text" &&
		(!p.signing.message || /[\p{Cc}\p{Cf}]/u.test(p.signing.message))
	)
		throw new Error(
			"Text message must be nonempty and have no terminal control characters",
		);
	const base = new URL(p.submit.base);
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
			"Submission requires HTTPS (HTTP is allowed only on loopback)",
		);
	if (
		!Object.hasOwn(writeRoutes, p.submit.route) ||
		p.submit.route.endsWith("/alert-dismiss") ||
		p.submit.route.endsWith("/builder-finalize")
	)
		throw new Error("Invalid submission route");
	if (
		p.submit.signatureField !== "signature" ||
		Object.hasOwn(p.submit.body, p.submit.signatureField)
	)
		throw new Error("Signature field must be empty at staging");
	if (!p.preflightPlan.checks.length)
		throw new Error("Proposal requires a stored preflight plan");
	for (const check of p.preflightPlan.checks) {
		if (
			!/^\/api\/(arbitrage\/(task|list|rates)|binding\/(rebind-check|(hl|aster|lighter)\/credential))$/.test(
				check.route,
			)
		)
			throw new Error("Preflight must use a public read without side effects");
		if (
			!check.assertions.length ||
			check.assertions.some(
				(a) =>
					!a.path.length ||
					a.path.some((key) =>
						["__proto__", "constructor", "prototype"].includes(key),
					),
			)
		)
			throw new Error("Preflight needs explicit assertions");
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
		throw new Error("Proposal integrity check failed");
	if (
		![
			"staged",
			"previewed",
			"awaiting-signature",
			"signed",
			"submitted",
			"confirmed",
			"rejected",
			"failed",
			"expired",
		].includes(p.status)
	)
		throw new Error("Invalid Proposal status");
	if (
		p.preflight &&
		(p.preflight.checks.length !== p.preflightPlan.checks.length ||
			!Number.isSafeInteger(p.preflight.checkedAt) ||
			p.preflight.checkedAt < p.createdAt ||
			(p.status !== "expired" && p.preflight.checkedAt >= p.expiresAt) ||
			p.preflight.checks.some(
				(check, i) =>
					check.route !== p.preflightPlan.checks[i].route ||
					typeof check.ok !== "boolean",
			) ||
			p.preflight.ok !== p.preflight.checks.every((check) => check.ok))
	)
		throw new Error("Invalid preflight result");
}
