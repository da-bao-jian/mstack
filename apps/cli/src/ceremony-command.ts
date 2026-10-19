import { redactKey } from "@mstack/keys";
import {
	type BindingTarget,
	bindingMessage,
	preparePayload,
	readPayload,
	StrategyApiClient,
	StrategyApiError,
	type VenueBindingBatch,
} from "@mstack/mobius-api";
import {
	type ApiKeyCreateBody,
	type ArbitrageVenue,
	apiKeyMessage,
	MobiusClient,
	type WriteRoutes,
} from "@mstack/mobius-client";
import {
	type Ceremony,
	type CeremonyProposal,
	CeremonyStore,
	ceremonyFingerprint,
	ceremonyStep,
	digest,
	type Json,
	type JsonObject,
} from "@mstack/proposals";
import {
	browserCeremonySigner,
	readSecretFromTty,
	type SecretReader,
	unlockKeystore,
	walletConnectCeremonySigner,
} from "@mstack/signers";
import { getAddress, type Hex } from "viem";
import pkg from "../package.json";
import {
	chooseSigner,
	getConfig,
	numberFlag,
	readConfig,
	SETUP_FIRST,
	UsageError,
} from "./config.ts";
import { storeCreatedKey } from "./key-create.ts";
import { cliKeyStore, requireWritableKeyStore } from "./key-store.ts";
import { keysCommand } from "./keys-command.ts";
import type { Runtime } from "./run.ts";
import { type LegalPlan, legalPlan, stageLegal } from "./setup-command.ts";
import { venueAccounts } from "./venue-accounts.ts";
import { walletWait } from "./wallet-wait.ts";

const allVenues = ["hl", "lighter", "aster", "lighter-mainnet"] as const;
type Venue = (typeof allVenues)[number];

function parseVenues(raw: unknown): Venue[] {
	if (raw === undefined) return [...allVenues];
	const venues = String(raw)
		.split(",")
		.map((item) => item.trim()) as Venue[];
	if (
		!venues.length ||
		new Set(venues).size !== venues.length ||
		venues.some((venue) => !allVenues.includes(venue))
	)
		throw new UsageError(
			"venues must contain 1 to 4 unique values: hl, aster, lighter, lighter-mainnet",
		);
	return venues;
}

async function alreadyBound(base: string, owner: string, rt: Runtime) {
	try {
		const value = await new MobiusClient({
			base,
			version: pkg.version,
			fetch: rt.fetch,
		}).read("/api/binding/readiness", { ownerAddress: owner });
		const rows = value.venues;
		return new Set(
			rows.flatMap((row) => {
				return row.ready === true && typeof row.venue === "string"
					? [row.venue]
					: [];
			}),
		);
	} catch {
		// The batch API remains authoritative when the legacy readiness route is absent.
		return new Set<string>();
	}
}

interface CeremonyExtras {
	/** Legal acceptance signed first, in the same wallet session. */
	legal?: LegalPlan;
	/** A scoped key created and stored once every venue is bound. */
	keyPlan?: { name: string; maxSizeUsd: number };
}

export async function stageCeremony(
	values: Record<string, string | boolean | undefined>,
	rt: Runtime,
	onComplete?: "stage-key",
	extras: CeremonyExtras = {},
) {
	const config = await readConfig(rt.home);
	if (!config.owner) throw new UsageError(SETUP_FIRST);
	if ((config.policy ?? "manual") !== "manual")
		throw new UsageError("Wallet policy is locked");
	const owner = getAddress(config.owner);
	const readinessBase = String(getConfig(config, "api_base"));
	const strategyBase = String(getConfig(config, "strategy_api_base"));
	const bound = await alreadyBound(readinessBase, owner, rt);
	const requested = parseVenues(values.venues);
	const venues = requested.filter((venue) => !bound.has(venue));
	if (!venues.length) {
		rt.out("Ready · all selected venues are already bound");
		return;
	}
	const lighterAccount =
		typeof values["lighter-account"] === "string"
			? numberFlag(values["lighter-account"], "lighter-account", 0, true)
			: undefined;
	const accounts = await venueAccounts(owner, venues, rt, lighterAccount);
	const targets: BindingTarget[] = venues.map((venue) => {
		if (venue === "hl")
			return {
				venue,
				signatureChainId: Number(getConfig(config, "hl_signature_chain_id")),
				...(values.rebind === true ? { rebind: true } : {}),
			};
		if (venue === "lighter" || venue === "lighter-mainnet")
			return {
				venue,
				accountIndex: accounts.get(venue) as number,
				...(values.rebind === true ? { rebind: true } : {}),
			};
		return { venue, ...(values.rebind === true ? { rebind: true } : {}) };
	});
	const store = new CeremonyStore(rt.home, rt.now, rt.err);
	const existing = (await store.list()).findLast(
		(ceremony) =>
			ceremony.owner === owner &&
			ceremony.apiBase === strategyBase &&
			!["complete", "partial", "rejected", "failed", "expired"].includes(
				ceremony.status,
			) &&
			JSON.stringify(ceremony.venues) === JSON.stringify(targets) &&
			Boolean(ceremony.legal) === Boolean(extras.legal) &&
			JSON.stringify(ceremony.keyPlan ?? null) ===
				JSON.stringify(extras.keyPlan ?? null),
	);
	const ceremony =
		existing ??
		(await store.stage({
			owner,
			apiBase: strategyBase,
			venues: targets,
			...(onComplete ? { onComplete } : {}),
			...(extras.legal
				? {
						legal: {
							signing: extras.legal.signing,
							base: extras.legal.base,
							body: extras.legal.body,
						},
					}
				: {}),
			...(extras.keyPlan ? { keyPlan: extras.keyPlan } : {}),
		}));
	if (extras.legal || extras.keyPlan) {
		const parts = [
			...(extras.legal ? ["accept legal terms"] : []),
			`bind ${venues.join(", ")}`,
			...(extras.keyPlan
				? [
						`create key “${extras.keyPlan.name}” (cap $${extras.keyPlan.maxSizeUsd.toLocaleString("en-US")}) and store it locally`,
					]
				: []),
		];
		rt.out(
			`${ceremony.id} · onboarding ceremony · ${venues.join(", ")} · ${ceremony.status}`,
		);
		rt.out(`One wallet session: ${parts.join(", then ")}.`);
	} else
		rt.out(
			`${ceremony.id} · venue binding ceremony · ${venues.join(", ")} · ${ceremony.status}`,
		);
	rt.out(`Next: mob sign ${ceremony.id}`);
	return ceremony;
}

export async function nativeOnboard(
	values: Record<string, string | boolean | undefined>,
	rt: Runtime,
) {
	const config = await readConfig(rt.home);
	if (!config.owner) throw new UsageError(SETUP_FIRST);
	const plan = await legalPlan(rt);
	if (plan === "locked") throw new UsageError("Wallet policy is locked");
	if (plan === "unavailable")
		rt.out(
			"Legal clickwrap is not configured on the auth server (503); continuing without it.",
		);
	const legal = typeof plan === "object" ? plan : undefined;
	const name = typeof values.name === "string" ? values.name.trim() : "mstack";
	if (!name || name.length > 64 || /[\p{Cc}\p{Cf}]/u.test(name))
		throw new UsageError("name must be 1 to 64 visible characters");
	const maxSizeUsd = numberFlag(
		typeof values["max-size"] === "string" ? values["max-size"] : "5000",
		"max-size",
		10,
	);
	await requireWritableKeyStore(rt, config.owner);
	const ceremony = await stageCeremony(values, rt, undefined, {
		legal,
		keyPlan: { name, maxSizeUsd },
	});
	if (ceremony) return;
	// Every requested venue is already bound: stage the remaining steps alone.
	if (legal) {
		await stageLegal(rt);
		return;
	}
	if (!(await (await cliKeyStore(rt)).get(getAddress(config.owner))))
		await keysCommand(
			["create"],
			{
				name,
				venues: parseVenues(values.venues).join(","),
				"max-size": String(maxSizeUsd),
			},
			rt,
		);
}

function view(step: CeremonyProposal) {
	return {
		id: step.id,
		owner: step.owner,
		purpose: step.purpose,
		expiresAt: step.expiresAt,
		digest: step.digest,
		signing: step.signing,
	};
}

function showStep(step: CeremonyProposal, index: number, total: number) {
	const exact =
		step.signing.type === "text"
			? step.signing.message
			: JSON.stringify(step.signing.typedData, null, 2);
	return [
		`${step.id} · step ${index} of ${total}`,
		`Purpose  ${step.purpose}`,
		step.signing.type === "text" ? "Exact message" : "Exact typed data",
		exact,
		`Digest   ${step.digest}`,
	].join("\n");
}

type Session = {
	address(): Promise<`0x${string}`>;
	sign(step: ReturnType<typeof view>): Promise<Hex>;
	addSteps?(steps: ReturnType<typeof view>[]): void;
	/** A browser page shows the failure before it closes. */
	close(failure?: unknown): Promise<void>;
};

function terminalResults(batch: VenueBindingBatch) {
	return batch.results.every((result) =>
		["bound", "already_bound", "failed", "expired"].includes(result.status),
	);
}

export async function signCeremony(
	id: string,
	values: Record<string, string | boolean | undefined>,
	rt: Runtime,
	read: SecretReader = readSecretFromTty,
) {
	const store = new CeremonyStore(rt.home, rt.now, rt.err);
	let ceremony = await store.get(id);
	if (
		["complete", "partial", "rejected", "failed", "expired"].includes(
			ceremony.status,
		)
	)
		throw new UsageError(`Ceremony ${id} is ${ceremony.status}`);
	const config = await readConfig(rt.home);
	if (!config.owner || getAddress(config.owner) !== getAddress(ceremony.owner))
		throw new UsageError("Configured owner does not match ceremony owner");
	if ((config.policy ?? "manual") !== "manual")
		throw new UsageError("Wallet policy is locked");
	// Only in-process callers (the approver) can pass a pinned fingerprint.
	if (
		typeof values.pin === "string" &&
		ceremonyFingerprint(ceremony) !== values.pin
	)
		throw new UsageError(
			`${id} changed after it was shown; nothing was signed`,
		);
	const backend = values.with ?? config.signer;
	if (!backend) throw new UsageError(chooseSigner(id));
	if (!["keystore", "browser", "walletconnect"].includes(String(backend)))
		throw new UsageError(`${backend} signer is not available in this build`);
	if (backend === "walletconnect" && !config.walletconnect_project_id)
		throw new UsageError(
			"Set walletconnect_project_id before using walletconnect",
		);
	let waiting: ReturnType<typeof walletWait> | undefined;
	let session: Session;
	// The server window binds the binding steps; the wallet session stays open
	// through status polling and the key step, which carries its own window.
	const deadline = ceremony.expiresAt + 900_000;
	const legalPending = Boolean(ceremony.legal && !ceremony.legal.signature);
	if (backend === "browser") {
		const browser = browserCeremonySigner(
			ceremony.id,
			ceremony.owner,
			deadline,
			{
				now: rt.now,
				openUrl: rt.openUrl,
				onUrl: (url) => {
					waiting = walletWait(rt, ceremony.expiresAt);
					waiting.show(url, "browser");
				},
			},
		);
		browser.addSteps([
			...(legalPending && ceremony.legal ? [view(ceremony.legal)] : []),
			view(ceremony.prepare),
		]);
		session = browser;
	} else if (backend === "walletconnect") {
		const wallet = walletConnectCeremonySigner(
			ceremony.id,
			ceremony.owner,
			deadline,
			{
				projectId: config.walletconnect_project_id as string,
				now: rt.now,
				createClient: rt.walletConnectClientFactory,
				onPairing: (uri) => {
					waiting = walletWait(rt, ceremony.expiresAt);
					waiting.show(uri, "walletconnect");
				},
			},
		);
		session = wallet;
	} else {
		const signer = await unlockKeystore(rt.home, ceremony.owner, read, {
			reusable: true,
		});
		session = {
			address: signer.address,
			async sign(step) {
				return step.signing.type === "text"
					? signer.signMessage({ message: step.signing.message })
					: signer.signTypedData(step.signing.typedData);
			},
			close: async () => signer.close?.(),
		};
	}
	let failure: unknown;
	try {
		if (getAddress(await session.address()) !== getAddress(ceremony.owner))
			throw new Error("Owner does not match signer address");
		const client = new StrategyApiClient({
			base: ceremony.apiBase,
			version: pkg.version,
			fetch: rt.fetch,
			now: rt.now,
		});
		let card = 0;
		const find = (record: Ceremony, stepId: string) =>
			stepId === record.prepare.id
				? record.prepare
				: stepId === record.read?.id
					? record.read
					: stepId === record.legal?.id
						? record.legal
						: stepId === record.key?.id
							? record.key
							: record.requests.find((item) => item.id === stepId);
		const total = () =>
			(ceremony.legal ? 1 : 0) +
			2 +
			ceremony.requests.length +
			(ceremony.keyPlan ? 1 : 0);
		const sign = async (step: CeremonyProposal) => {
			if (rt.now() >= step.expiresAt)
				throw new Error("Ceremony step expired before signing");
			card++;
			rt.out(showStep(step, card, total()));
			await store.update(id, (record) => {
				const stored = find(record, step.id);
				if (!stored || stored.signatureAttemptedAt !== undefined)
					throw new Error(
						"Ceremony step is terminal or already used for signing",
					);
				stored.signatureAttemptedAt = rt.now();
			});
			try {
				const signature = await session.sign(view(step));
				await store.update(id, (record) => {
					const stored = find(record, step.id);
					if (!stored) throw new Error("Ceremony step disappeared");
					stored.signature = signature;
					stored.status = "signed";
					if (stored.requestId)
						record.signatures.push({ requestId: stored.requestId, signature });
				});
				return signature;
			} catch (error) {
				await store.update(id, (record) => {
					const stored = find(record, step.id);
					if (stored) stored.status = "rejected";
				});
				throw error;
			}
		};

		const createKeyInSession = async (current: Ceremony, venues: string[]) => {
			const plan = current.keyPlan;
			if (!plan) return;
			const createdAt = rt.now();
			if (createdAt >= deadline) {
				rt.out(
					`Wallet session deadline passed before the key step. Retry with mob keys create --name '${plan.name}' --venues '${venues.join(",")}' --max-size '${plan.maxSizeUsd}'.`,
				);
				return;
			}
			const timestamp = Math.floor(createdAt / 1000);
			const nonce = crypto.randomUUID();
			const body: JsonObject = {
				owner: current.owner,
				name: plan.name,
				venues,
				maxSizeUsd: plan.maxSizeUsd,
				nonce,
				timestamp,
			};
			const signing = {
				type: "text" as const,
				message: apiKeyMessage("create", {
					owner: current.owner,
					timestamp,
					name: plan.name,
					venues: venues as ArbitrageVenue[],
					maxSizeUsd: plan.maxSizeUsd,
					nonce,
				}),
			};
			const fundingBase = String(getConfig(config, "api_base"));
			ceremony = await store.update(id, (record) => {
				if (!record.key)
					record.key = ceremonyStep(
						`${id}:key`,
						record.owner,
						`Create API key “${plan.name}” · venues ${venues.join(", ")} · cap $${plan.maxSizeUsd}`,
						signing,
						createdAt,
						Math.min(createdAt + 300_000, deadline),
						{ type: "key-ceremony", base: fundingBase, body },
					);
			});
			const keyStep = ceremony.key;
			if (keyStep?.submit.type !== "key-ceremony")
				throw new Error("Ceremony key step was not stored");
			session.addSteps?.([view(keyStep)]);
			try {
				// The server shows the secret once: never create it into a store
				// that cannot keep it.
				await requireWritableKeyStore(rt, current.owner);
				const signature = keyStep.signature ?? (await sign(keyStep));
				const answer = (await new MobiusClient({
					base: keyStep.submit.base,
					version: pkg.version,
					fetch: rt.fetch,
				}).write(
					"/api/keys/create",
					{ ...keyStep.submit.body, signature } as unknown as ApiKeyCreateBody,
					AbortSignal.timeout(Math.max(1, keyStep.expiresAt - rt.now())),
				)) as unknown as Json;
				const stored = await storeCreatedKey(
					rt,
					current.owner,
					keyStep.submit.body,
					answer,
				);
				const prefix = String(stored.key);
				const backend = String(stored.backend);
				await store.update(id, (record) => {
					record.keyResult = { prefix, backend };
					record.status = "complete";
				});
				rt.out(`Key ${prefix} stored in ${backend}.`);
				rt.out(
					`Ready · ${venues.length} venues bound · key ${prefix} · cap $${plan.maxSizeUsd.toLocaleString("en-US")}`,
				);
			} catch (error) {
				const message = redactKey(
					error instanceof Error ? error.message : String(error),
				);
				await store.update(id, (record) => {
					record.status = "partial";
					record.error = message;
				});
				rt.out(
					`Key creation did not complete: ${message}. Retry with mob keys create --name '${plan.name}' --venues '${venues.join(",")}' --max-size '${plan.maxSizeUsd}'.`,
				);
			}
		};

		if (ceremony.legal && !ceremony.legal.signature) {
			const legal = ceremony.legal;
			if (legal.submit.type !== "legal-ceremony")
				throw new Error("Invalid legal step");
			const signature = await sign(legal);
			await new MobiusClient({
				base: legal.submit.base,
				version: pkg.version,
				fetch: rt.fetch,
			}).write(
				"/legal/acceptance" as keyof WriteRoutes,
				{
					...legal.submit.body,
					signature,
				} as WriteRoutes[keyof WriteRoutes]["body"],
				AbortSignal.timeout(Math.max(1, legal.expiresAt - rt.now())),
			);
			rt.out("Legal terms accepted.");
			ceremony = await store.get(id);
		}

		let prepareSignature = ceremony.prepare.signature;
		if (!prepareSignature) {
			prepareSignature = await sign(ceremony.prepare);
			ceremony = await store.update(id, (record) => {
				record.status = "preparing";
			});
		}
		if (!ceremony.bindingId) {
			const payload = preparePayload(
				{
					owner: ceremony.owner,
					venues: ceremony.venues,
					nonce: ceremony.nonce,
					expiresAt: Math.floor(ceremony.expiresAt / 1000),
				},
				rt.now,
			);
			let prepared: VenueBindingBatch;
			try {
				prepared = await client.prepareVenueBindings(
					{
						owner: payload.owner,
						venues: payload.venues,
						authorization: {
							nonce: ceremony.nonce,
							expiresAt: Math.floor(ceremony.expiresAt / 1000),
							signature: prepareSignature,
						},
					},
					{ idempotencyKey: ceremony.prepareIdempotencyKey },
				);
			} catch (error) {
				if (
					error instanceof StrategyApiError &&
					error.code === "rebind_required"
				)
					throw new UsageError(
						"A venue requires repair. Review active tasks, then rerun with --rebind.",
					);
				throw error;
			}
			ceremony = await store.recordPrepared(id, prepared);
		}

		session.addSteps?.(ceremony.requests.map(view));
		let rejected = false;
		for (const step of ceremony.requests) {
			if (step.signature) continue;
			try {
				await sign(step);
			} catch (error) {
				if (
					!/reject/i.test(
						error instanceof Error ? error.message : String(error),
					)
				)
					throw error;
				rejected = true;
				break;
			}
		}
		ceremony = await store.get(id);
		if (!ceremony.bindingId) throw new Error("Ceremony has no binding id");
		const bindingId = ceremony.bindingId;
		if (rejected) {
			if (ceremony.signatures.length)
				await client.submitVenueBindings(
					bindingId,
					{ signatures: ceremony.signatures },
					{ idempotencyKey: ceremony.submitIdempotencyKey },
				);
			const incomplete = [
				...new Set(
					ceremony.requests
						.filter((step) => !step.signature)
						.map((step) => step.venue),
				),
			].filter(Boolean);
			await store.update(id, (record) => {
				record.status = "partial";
			});
			rt.out(`Ceremony partial · ${incomplete.join(", ")} stays incomplete`);
			return;
		}

		const readExpiresAt = Math.floor(ceremony.expiresAt / 1000);
		const readBody = readPayload(
			{ owner: ceremony.owner, bindingId, expiresAt: readExpiresAt },
			rt.now,
		);
		const readSigning = {
			type: "text" as const,
			message: bindingMessage("read", readBody),
		};
		ceremony = await store.update(id, (record) => {
			if (!record.read)
				record.read = {
					id: `${id}:read`,
					kind: "sign-text",
					owner: record.owner,
					purpose: "Authorize binding status reads",
					createdAt: rt.now(),
					expiresAt: record.expiresAt,
					digest: digest(readSigning),
					signing: readSigning,
					status: "awaiting-signature",
					submit: { type: "read-ceremony" },
				};
		});
		if (!ceremony.read) throw new Error("Ceremony read step was not stored");
		session.addSteps?.([view(ceremony.read)]);
		const readSignature =
			ceremony.read.signature ?? (await sign(ceremony.read));
		await store.update(id, (record) => {
			record.status = "submitting";
		});
		let latest = await client.submitVenueBindings(
			bindingId,
			{ signatures: (await store.get(id)).signatures },
			{ idempotencyKey: ceremony.submitIdempotencyKey },
		);
		await store.update(id, (record) => {
			record.latest = latest;
			record.status = "polling";
		});
		const pollStarted = rt.now();
		while (!terminalResults(latest) && rt.now() - pollStarted < 600_000) {
			latest = await client.getVenueBinding(bindingId, {
				owner: ceremony.owner,
				expiresAt: readExpiresAt,
				signature: readSignature,
			});
			await store.update(id, (record) => {
				record.latest = latest;
			});
			if (!terminalResults(latest)) await (rt.sleep ?? Bun.sleep)(5000);
		}
		const successful = latest.results.filter((result) =>
			["bound", "already_bound"].includes(result.status),
		);
		const failures = latest.results.filter(
			(result) => result.status === "failed",
		);
		await store.update(id, (record) => {
			record.status =
				successful.length === latest.results.length
					? "complete"
					: successful.length
						? "partial"
						: "failed";
			record.latest = latest;
		});
		for (const result of failures)
			rt.out(
				`${result.venue} failed · ${result.code ?? "unknown"} · retryable ${result.retryable ?? false}`,
			);
		rt.out(
			`${id} ${successful.length === latest.results.length ? "complete" : "partial"} · ${successful.length} venues bound`,
		);
		if (ceremony.keyPlan && successful.length === latest.results.length)
			await createKeyInSession(
				ceremony,
				successful.map((r) => r.venue),
			);
		else if (
			ceremony.onComplete === "stage-key" &&
			successful.length === latest.results.length
		)
			await keysCommand(
				["create"],
				{
					name: "mstack",
					venues: successful.map((result) => result.venue).join(","),
					"max-size": "5000",
				},
				rt,
				read,
			);
	} catch (error) {
		failure = error;
		throw error;
	} finally {
		waiting?.stop();
		await session.close(failure);
	}
}
