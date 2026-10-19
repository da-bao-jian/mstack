import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
	type BindingTarget,
	bindingMessage,
	classifySignRequest,
	preparePayload,
	type SignRequest,
	type VenueBindingBatch,
} from "@mstack/mobius-api";
import { lighterIntegratorApprovalMessage } from "@mstack/mobius-client";
import { getAddress, type Hex, type TypedDataDefinition } from "viem";
import {
	canonical,
	digest,
	type JsonObject,
	type SigningPayload,
} from "./model.ts";
import {
	atomic,
	exclusive,
	locked,
	privateDirectory,
	readPrivate,
} from "./storage.ts";

export type CeremonyStepStatus =
	| "awaiting-signature"
	| "signed"
	| "rejected"
	| "failed";

export type CeremonySigningPayload = Exclude<SigningPayload, { type: "none" }>;

export interface CeremonyProposal {
	id: string;
	kind: "sign-text" | "sign-typed";
	owner: `0x${string}`;
	purpose: string;
	createdAt: number;
	expiresAt: number;
	digest: Hex;
	signing: CeremonySigningPayload;
	status: CeremonyStepStatus;
	submit:
		| { type: "prepare-ceremony" }
		| { type: "collect-ceremony"; requestId: string }
		| { type: "read-ceremony" }
		| { type: "legal-ceremony"; base: string; body: JsonObject }
		| { type: "key-ceremony"; base: string; body: JsonObject }
		| { type: "integrator-ceremony"; base: string; body: JsonObject };
	requestId?: string;
	venue?: string;
	action?: string;
	signature?: Hex;
	signatureAttemptedAt?: number;
	error?: string;
}

export type CeremonyStatus =
	| "awaiting-prepare-signature"
	| "preparing"
	| "awaiting-request-signatures"
	| "submitting"
	| "polling"
	| "complete"
	| "partial"
	| "rejected"
	| "failed"
	| "expired";

export interface Ceremony {
	version: 1;
	id: string;
	owner: `0x${string}`;
	apiBase: string;
	venues: BindingTarget[];
	createdAt: number;
	expiresAt: number;
	nonce: string;
	status: CeremonyStatus;
	prepareIdempotencyKey: string;
	submitIdempotencyKey: string;
	/** Absent when every selected venue only needs its integrator approval. */
	prepare?: CeremonyProposal;
	requests: CeremonyProposal[];
	signatures: { requestId: string; signature: Hex }[];
	bindingId?: string;
	read?: CeremonyProposal;
	latest?: VenueBindingBatch;
	error?: string;
	onComplete?: "stage-key";
	/** Legal acceptance signed first, in the same wallet session. */
	legal?: CeremonyProposal;
	/** A scoped API key created and stored once every venue is bound. */
	keyPlan?: { name: string; maxSizeUsd: number };
	/** Selected venues MoB already reports ready; the key covers them too. */
	ready?: string[];
	/** Bound Lighter venues that need only the zero-fee integrator approval. */
	integrators?: { venue: LighterVenue; integratorIndex: number }[];
	/** Integrator approval steps. Each is created when it is signed, because
	 * MoB accepts its timestamp for only 300 seconds. */
	approvals?: CeremonyProposal[];
	key?: CeremonyProposal;
	keyResult?: { prefix: string; backend: string };
}

type Stored = Ceremony & { recordHash: string };
/** MoB's binding session after prepare (api-server venue-bindings.md). */
const REQUEST_WINDOW = 600_000;
type LighterVenue = "lighter" | "lighter-mainnet";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * What a ceremony card commits to before any signature: owner, API base,
 * venues, the prepare and legal steps, and the key plan. An approver pins
 * this when it shows the card and the signer checks it again, so the record
 * cannot change in between. Server-returned request steps are classified
 * separately when they arrive.
 */
export function ceremonyFingerprint(ceremony: Ceremony): Hex {
	return `0x${hash(
		canonical({
			owner: ceremony.owner,
			apiBase: ceremony.apiBase,
			venues: ceremony.venues,
			prepare: ceremony.prepare?.digest ?? null,
			legal: ceremony.legal?.digest ?? null,
			keyPlan: ceremony.keyPlan ?? null,
			ready: ceremony.ready ?? null,
			integrators: ceremony.integrators ?? null,
			requests: ceremony.requests.map((step) => [
				step.id,
				step.purpose,
				step.digest,
			]),
		}),
	)}`;
}

function requestPurpose(venue: string, action: string, capability: string) {
	return `Bind ${venue}: ${action} (${capability})`;
}

/** Re-checks a stored request step against the binding allow-list. */
function checkRequestStep(
	ceremony: Ceremony,
	step: CeremonyProposal,
	now?: () => number,
): void {
	const classified = classifySignRequest(
		{
			requestId: step.requestId,
			venue: step.venue,
			action: step.action,
			method:
				step.signing.type === "text" ? "personal_sign" : "eth_signTypedData_v4",
			payload:
				step.signing.type === "text"
					? { message: step.signing.message }
					: step.signing.typedData,
		},
		{
			owner: ceremony.owner,
			venues: ceremony.venues.map((target) => target.venue),
			now,
		},
	);
	if (
		step.id !== `${ceremony.id}:${classified.requestId}` ||
		step.purpose !==
			requestPurpose(classified.venue, classified.action, classified.capability)
	)
		throw new Error("Ceremony request step mismatch");
}

function serialize(ceremony: Ceremony): string {
	const bytes = `${JSON.stringify(ceremony, null, 2)}\n`;
	return `${JSON.stringify({ ...ceremony, recordHash: hash(bytes) }, null, 2)}\n`;
}

function parse(raw: string): Ceremony {
	let stored: Stored;
	try {
		stored = JSON.parse(raw) as Stored;
	} catch {
		throw new Error("Ceremony JSON is malformed");
	}
	if (!stored || typeof stored !== "object" || Array.isArray(stored))
		throw new Error("Ceremony record must be an object");
	const { recordHash, ...ceremony } = stored;
	if (recordHash !== hash(`${JSON.stringify(ceremony, null, 2)}\n`))
		throw new Error("Ceremony record integrity check failed");
	validate(ceremony as Ceremony);
	return ceremony as Ceremony;
}

export function ceremonyStep(
	id: string,
	owner: `0x${string}`,
	purpose: string,
	signing: CeremonySigningPayload,
	createdAt: number,
	expiresAt: number,
	submit: CeremonyProposal["submit"],
	extra: Pick<CeremonyProposal, "requestId" | "venue" | "action"> = {},
): CeremonyProposal {
	return {
		id,
		kind: signing.type === "text" ? "sign-text" : "sign-typed",
		owner,
		purpose,
		createdAt,
		expiresAt,
		digest: digest(signing),
		signing,
		status: "awaiting-signature",
		submit,
		...extra,
	};
}

function validate(ceremony: Ceremony): void {
	canonical(ceremony);
	if (ceremony.version !== 1 || !/^c-[1-9]\d*$/.test(ceremony.id))
		throw new Error("Invalid ceremony identity");
	getAddress(ceremony.owner);
	const base = new URL(ceremony.apiBase);
	if (
		!["http:", "https:"].includes(base.protocol) ||
		base.username ||
		base.password ||
		base.search ||
		base.hash
	)
		throw new Error("Invalid ceremony API base");
	if (
		!Number.isSafeInteger(ceremony.createdAt) ||
		!Number.isSafeInteger(ceremony.expiresAt) ||
		ceremony.expiresAt <= ceremony.createdAt
	)
		throw new Error("Invalid ceremony times");
	const integrators = ceremony.integrators ?? [];
	if (
		!Array.isArray(ceremony.venues) ||
		!Array.isArray(integrators) ||
		!(ceremony.venues.length || integrators.length)
	)
		throw new Error("Ceremony needs venues");
	if (Boolean(ceremony.prepare) !== ceremony.venues.length > 0)
		throw new Error("Ceremony prepare step mismatch");
	const selected = new Set<string>(
		ceremony.venues.map((target) => target.venue),
	);
	for (const item of integrators) {
		if (
			!["lighter", "lighter-mainnet"].includes(item.venue) ||
			!Number.isSafeInteger(item.integratorIndex) ||
			item.integratorIndex <= 0 ||
			selected.has(item.venue)
		)
			throw new Error("Invalid ceremony integrator approval");
		selected.add(item.venue);
	}
	if (
		ceremony.ready !== undefined &&
		(!Array.isArray(ceremony.ready) ||
			ceremony.ready.some(
				(venue) => typeof venue !== "string" || selected.has(venue),
			))
	)
		throw new Error("Invalid ceremony ready venues");
	for (const step of ceremony.approvals ?? []) {
		const plan = integrators.find((item) => item.venue === step.venue);
		const body =
			step.submit.type === "integrator-ceremony" ? step.submit.body : {};
		if (
			!plan ||
			step.id !== `${ceremony.id}:integrator-${plan.venue}` ||
			step.owner !== ceremony.owner ||
			!Number.isSafeInteger(step.createdAt) ||
			step.createdAt < ceremony.createdAt ||
			step.expiresAt <= step.createdAt ||
			step.expiresAt - step.createdAt > 300_000 ||
			step.kind !== "sign-text" ||
			step.signing.type !== "text" ||
			step.submit.type !== "integrator-ceremony" ||
			body.ownerAddress !== ceremony.owner.toLowerCase() ||
			body.venue !== plan.venue ||
			typeof body.nonce !== "string" ||
			typeof body.timestamp !== "number" ||
			step.signing.message !==
				lighterIntegratorApprovalMessage({
					ownerAddress: ceremony.owner,
					venue: plan.venue,
					integratorIndex: plan.integratorIndex,
					nonce: body.nonce,
					timestamp: body.timestamp,
				}) ||
			digest(step.signing) !== step.digest
		)
			throw new Error("Ceremony integrator step mismatch");
	}
	if (!Array.isArray(ceremony.requests) || !Array.isArray(ceremony.signatures))
		throw new Error("Invalid ceremony steps");
	if (
		ceremony.keyPlan !== undefined &&
		(typeof ceremony.keyPlan.name !== "string" ||
			!ceremony.keyPlan.name ||
			!Number.isFinite(ceremony.keyPlan.maxSizeUsd) ||
			ceremony.keyPlan.maxSizeUsd <= 0)
	)
		throw new Error("Invalid ceremony key plan");
	if (ceremony.key) {
		const key = ceremony.key;
		// The key step is created after binding, so it carries its own window.
		if (
			key.owner !== ceremony.owner ||
			!Number.isSafeInteger(key.createdAt) ||
			!Number.isSafeInteger(key.expiresAt) ||
			key.createdAt < ceremony.createdAt ||
			key.expiresAt <= key.createdAt ||
			key.kind !== "sign-text" ||
			key.signing.type !== "text" ||
			key.submit.type !== "key-ceremony" ||
			digest(key.signing) !== key.digest
		)
			throw new Error("Ceremony key step mismatch");
	}
	const own = new Set([...ceremony.requests, ceremony.read]);
	for (const proposal of [
		...(ceremony.legal ? [ceremony.legal] : []),
		...(ceremony.prepare ? [ceremony.prepare] : []),
		...ceremony.requests,
		...(ceremony.read ? [ceremony.read] : []),
	]) {
		// Request and read steps carry their own window inside MoB's session.
		if (
			proposal.owner !== ceremony.owner ||
			(own.has(proposal)
				? proposal.expiresAt < ceremony.expiresAt ||
					proposal.expiresAt > ceremony.expiresAt + REQUEST_WINDOW
				: proposal.expiresAt !== ceremony.expiresAt)
		)
			throw new Error("Ceremony Proposal identity mismatch");
		if (
			!["text", "typed"].includes(proposal.signing.type) ||
			(proposal.kind === "sign-text") !== (proposal.signing.type === "text")
		)
			throw new Error("Ceremony Proposal kind does not match signing payload");
		if (digest(proposal.signing) !== proposal.digest)
			throw new Error("Ceremony Proposal digest mismatch");
	}
	// A stored request is checked again on every load, so an edited ceremony
	// file cannot carry a payload the server path would have refused.
	const ids = new Set<string | undefined>();
	for (const step of ceremony.requests) {
		checkRequestStep(ceremony, step);
		if (ids.has(step.requestId)) throw new Error("Duplicate ceremony request");
		ids.add(step.requestId);
	}
}

export class CeremonyStore {
	readonly directory: string;
	constructor(
		readonly home: string,
		readonly now = Date.now,
		readonly log: (message: string) => void = console.error,
	) {
		this.directory = join(home, "ceremonies");
	}
	private path(id: string) {
		if (!/^c-[1-9]\d*$/.test(id)) throw new Error("Invalid ceremony id");
		return join(this.directory, `${id}.json`);
	}
	private async ready() {
		await privateDirectory(this.home);
		await privateDirectory(this.directory);
	}
	private async save(ceremony: Ceremony) {
		validate(ceremony);
		await atomic(this.path(ceremony.id), serialize(ceremony));
	}
	async get(id: string): Promise<Ceremony> {
		let raw: string;
		try {
			raw = await readPrivate(this.path(id));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT")
				throw new Error(`No ceremony ${id}`);
			throw error;
		}
		const ceremony = parse(raw);
		if (ceremony.id !== id) throw new Error("Ceremony id mismatch");
		if (
			this.now() >= ceremony.expiresAt &&
			!["complete", "partial", "rejected", "failed"].includes(ceremony.status)
		)
			ceremony.status = "expired";
		return ceremony;
	}
	async list(): Promise<Ceremony[]> {
		await this.ready();
		return Promise.all(
			(await readdir(this.directory))
				.filter((file) => /^c-[1-9]\d*\.json$/.test(file))
				.sort((a, b) => Number(a.slice(2, -5)) - Number(b.slice(2, -5)))
				.map((file) => this.get(file.slice(0, -5))),
		);
	}
	async stage(input: {
		owner: string;
		apiBase: string;
		venues: BindingTarget[];
		onComplete?: "stage-key";
		legal?: { signing: CeremonySigningPayload; base: string; body: JsonObject };
		keyPlan?: { name: string; maxSizeUsd: number };
		ready?: string[];
		integrators?: { venue: LighterVenue; integratorIndex: number }[];
	}): Promise<Ceremony> {
		const owner = getAddress(input.owner);
		await this.ready();
		return locked(
			join(this.directory, "counter.lock"),
			async () => {
				let previous = 0;
				try {
					const raw = await readPrivate(join(this.directory, "counter"));
					if (!/^\d+\n$/.test(raw)) throw new Error("Invalid ceremony counter");
					previous = Number(raw.trim());
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
				const id = `c-${previous + 1}`;
				const createdAt = this.now();
				const expiresAt = createdAt + 300_000;
				const nonce = crypto.randomUUID();
				const venues = structuredClone(input.venues);
				const signing = venues.length
					? {
							type: "text" as const,
							message: bindingMessage(
								"prepare",
								preparePayload(
									{
										owner,
										venues,
										nonce,
										expiresAt: Math.floor(expiresAt / 1000),
									},
									this.now,
								),
							),
						}
					: undefined;
				const ceremony: Ceremony = {
					version: 1,
					id,
					owner,
					apiBase: input.apiBase,
					venues,
					createdAt,
					expiresAt,
					nonce,
					status: "awaiting-prepare-signature",
					prepareIdempotencyKey: `${id}:prepare:${crypto.randomUUID()}`,
					submitIdempotencyKey: `${id}:${crypto.randomUUID()}`,
					...(signing
						? {
								prepare: ceremonyStep(
									`${id}:prepare`,
									owner,
									"Authorize venue binding preparation",
									signing,
									createdAt,
									expiresAt,
									{ type: "prepare-ceremony" },
								),
							}
						: {}),
					requests: [],
					signatures: [],
					...(input.onComplete ? { onComplete: input.onComplete } : {}),
					...(input.legal
						? {
								legal: ceremonyStep(
									`${id}:legal`,
									owner,
									"Accept MoB legal terms",
									structuredClone(input.legal.signing),
									createdAt,
									expiresAt,
									{
										type: "legal-ceremony",
										base: input.legal.base,
										body: structuredClone(input.legal.body),
									},
								),
							}
						: {}),
					...(input.keyPlan ? { keyPlan: { ...input.keyPlan } } : {}),
					...(input.ready?.length ? { ready: [...input.ready] } : {}),
					...(input.integrators?.length
						? { integrators: structuredClone(input.integrators) }
						: {}),
				};
				validate(ceremony);
				await atomic(join(this.directory, "counter"), `${previous + 1}\n`);
				await exclusive(this.path(id), serialize(ceremony));
				return ceremony;
			},
			this.log,
		);
	}
	async update(
		id: string,
		edit: (ceremony: Ceremony) => void,
	): Promise<Ceremony> {
		return locked(
			`${this.path(id)}.lock`,
			async () => {
				const ceremony = await this.get(id);
				edit(ceremony);
				await this.save(ceremony);
				return structuredClone(ceremony);
			},
			this.log,
		);
	}
	async recordPrepared(
		id: string,
		batch: VenueBindingBatch,
	): Promise<Ceremony> {
		return this.update(id, (ceremony) => {
			if (getAddress(batch.owner) !== getAddress(ceremony.owner))
				throw new Error("Prepared binding owner mismatch");
			ceremony.bindingId = batch.bindingId;
			ceremony.latest = structuredClone(batch);
			const venues = ceremony.venues.map((target) => target.venue);
			// MoB keeps a binding session for 10 minutes after prepare; the
			// request steps share that window instead of the staging window.
			const requestsExpireAt = Math.min(
				Date.parse(batch.expiresAt) || ceremony.expiresAt,
				ceremony.expiresAt + REQUEST_WINDOW,
			);
			const preparedAt = Math.min(this.now(), requestsExpireAt - 1);
			ceremony.requests = batch.signRequests.map((request: SignRequest) => {
				const classified = classifySignRequest(request, {
					owner: ceremony.owner,
					venues,
					now: this.now,
				});
				const signing: CeremonySigningPayload =
					request.method === "personal_sign"
						? {
								type: "text",
								message: (request.payload as { message: string }).message,
							}
						: {
								type: "typed",
								typedData: structuredClone(
									request.payload,
								) as TypedDataDefinition,
							};
				return ceremonyStep(
					`${id}:${request.requestId}`,
					ceremony.owner,
					requestPurpose(
						classified.venue,
						classified.action,
						classified.capability,
					),
					signing,
					preparedAt,
					Math.max(requestsExpireAt, ceremony.expiresAt),
					{ type: "collect-ceremony", requestId: request.requestId },
					{
						requestId: request.requestId,
						venue: request.venue,
						action: request.action,
					},
				);
			});
			ceremony.status = ceremony.requests.length
				? "awaiting-request-signatures"
				: "submitting";
		});
	}
}
