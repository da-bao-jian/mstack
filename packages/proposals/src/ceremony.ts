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
import { getAddress, type Hex, type TypedDataDefinition } from "viem";
import { canonical, digest, type SigningPayload } from "./model.ts";
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
		| { type: "read-ceremony" };
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
	prepare: CeremonyProposal;
	requests: CeremonyProposal[];
	signatures: { requestId: string; signature: Hex }[];
	bindingId?: string;
	read?: CeremonyProposal;
	latest?: VenueBindingBatch;
	error?: string;
	onComplete?: "stage-key";
}

type Stored = Ceremony & { recordHash: string };
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

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

function step(
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
	if (!Array.isArray(ceremony.venues) || !ceremony.venues.length)
		throw new Error("Ceremony needs venues");
	if (!Array.isArray(ceremony.requests) || !Array.isArray(ceremony.signatures))
		throw new Error("Invalid ceremony steps");
	for (const proposal of [
		ceremony.prepare,
		...ceremony.requests,
		...(ceremony.read ? [ceremony.read] : []),
	]) {
		if (
			proposal.owner !== ceremony.owner ||
			proposal.expiresAt !== ceremony.expiresAt
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
				const payload = preparePayload(
					{ owner, venues, nonce, expiresAt: Math.floor(expiresAt / 1000) },
					this.now,
				);
				const signing = {
					type: "text" as const,
					message: bindingMessage("prepare", payload),
				};
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
					prepare: step(
						`${id}:prepare`,
						owner,
						"Authorize venue binding preparation",
						signing,
						createdAt,
						expiresAt,
						{ type: "prepare-ceremony" },
					),
					requests: [],
					signatures: [],
					...(input.onComplete ? { onComplete: input.onComplete } : {}),
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
			ceremony.requests = batch.signRequests.map((request: SignRequest) => {
				const classified = classifySignRequest(request);
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
				return step(
					`${id}:${request.requestId}`,
					ceremony.owner,
					`Bind ${classified.venue}: ${classified.action}`,
					signing,
					ceremony.createdAt,
					ceremony.expiresAt,
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
