import { redactKey } from "@mstack/keys";
import {
	ApiError,
	type ApiKeyCreateBody,
	type ApiKeyListBody,
	type ApiKeyRevokeBody,
	MobiusClient,
} from "@mstack/mobius-client";
import {
	CeremonyStore,
	type Json,
	type Proposal,
	ProposalStore,
	publicText,
	runPreflight,
} from "@mstack/proposals";
import {
	browserSigner,
	createKeystore,
	importKeystore,
	listKeystores,
	readSecretFromTty,
	type SecretReader,
	type Signer,
	unlockKeystore,
	walletConnectSigner,
} from "@mstack/signers";
import { getAddress } from "viem";
import pkg from "../package.json";
import { explainCeremonyFailure } from "./binding-errors.ts";
import {
	chooseSigner,
	readConfig,
	rememberSigner,
	SETUP_FIRST,
	UsageError,
} from "./config.ts";
import { expiry } from "./format.ts";
import { storeCreatedKey } from "./key-create.ts";
import { cliKeyStore, requireWritableKeyStore } from "./key-store.ts";
import { keyListTable } from "./keys-command.ts";
import { object, submitPlan } from "./onboarding-http.ts";
import { CheckFailure, Checks, configChecks } from "./preflight/checks.ts";
import {
	ceremonyCard,
	ceremonySteps,
	proposalTiming,
	proposalView,
	showProposal,
} from "./proposal-view.ts";
import { refreshExpired } from "./refresh-proposal.ts";
import { restageProposal } from "./restage.ts";
import type { Runtime } from "./run.ts";
import { walletWait } from "./wallet-wait.ts";

/** The command that stages a Proposal with the same intent. */
function restageFor(p: Proposal): string {
	const body = p.submit.body ?? {};
	switch (p.submit.route) {
		case "/api/keys/list":
			return "mob keys list";
		case "/api/keys/revoke":
			return `mob keys revoke ${String(body.id)}`;
		case "/api/keys/create":
			return `mob keys create --name '${String(body.name)}' --venues '${Array.isArray(body.venues) ? body.venues.join(",") : ""}' --max-size '${String(body.maxSizeUsd)}'`;
		case "/legal/acceptance":
			return "mob setup";
		default:
			return p.status === "expired"
				? `mob restage ${p.id}`
				: "the command that staged it";
	}
}

export async function p1(
	command: string,
	args: string[],
	values: Record<string, string | boolean | undefined>,
	rt: Runtime,
	read: SecretReader = readSecretFromTty,
): Promise<void> {
	if (command === "sign" && args.length === 1) {
		// A human's approver terminal signs for an agent that has no TTY, or
		// whenever the caller asks for it explicitly.
		const backend = values.with ?? (await readConfig(rt.home)).signer;
		const { approverStatus, relayToApprover } = await import("./approver.ts");
		if (
			backend === "approver" ||
			(backend === "keystore" &&
				!rt.stdinIsTTY &&
				(await approverStatus(rt.home)).running)
		) {
			if ((await relayToApprover(args[0], rt)) !== 0)
				throw new UsageError(`${args[0]} was not signed by the approver`);
			return;
		}
	}
	if (command === "sign" && args.length === 1 && /^c-[1-9]\d*$/.test(args[0])) {
		const { signCeremony } = await import("./ceremony-command.ts");
		await signCeremony(args[0], values, rt, read);
		return;
	}
	const store = new ProposalStore(rt.home, rt.now, rt.err);
	const show = (p: Awaited<ReturnType<ProposalStore["get"]>>) =>
		values.json
			? JSON.stringify(proposalView(p), null, 2)
			: showProposal(p, rt.now(), rt);
	if (command === "keystore") {
		if (args.length !== 1 || !["create", "import", "list"].includes(args[0]))
			throw new UsageError("Usage: mob keystore create | import | list");
		if (args[0] === "list")
			rt.out((await listKeystores(rt.home)).join("\n") || "No keystores.");
		else
			rt.out(
				`Keystore: ${await (args[0] === "create" ? createKeystore(rt.home, read) : importKeystore(rt.home, read))}`,
			);
		return;
	}
	if (command === "proposals") {
		if (args.length) throw new UsageError("Usage: mob proposals");
		const proposals = await store.list();
		const ceremonies = await new CeremonyStore(rt.home, rt.now, rt.err).list();
		if (values.json) {
			rt.out(
				JSON.stringify(
					[
						...proposals.map(proposalView),
						...ceremonies.map((ceremony) => ({
							id: ceremony.id,
							kind: "ceremony",
							status: ceremony.status,
							owner: ceremony.owner,
							venues: ceremony.venues,
							expiresAt: ceremony.expiresAt,
						})),
					],
					null,
					2,
				),
			);
			return;
		}
		rt.out(
			[
				...proposals.map(
					(p) =>
						`${p.id}\t${p.kind === "api-submit" ? "api" : "wallet"}\t${p.status}\t${proposalTiming(p, rt.now())}\t${p.purpose}`,
				),
				...ceremonies.map(
					(ceremony) =>
						`${ceremony.id}\tceremony\t${ceremony.status}\t${expiry(ceremony.expiresAt, rt.now())}\t${ceremony.venues.map((venue) => venue.venue).join(", ")}`,
				),
			].join("\n") || "No proposals.",
		);
		return;
	}
	if (command === "proposal") {
		if (args.length !== 2 || args[0] !== "show")
			throw new UsageError("Usage: mob proposal show <id>");
		if (/^c-[1-9]\d*$/.test(args[1])) {
			const ceremony = await new CeremonyStore(rt.home, rt.now, rt.err).get(
				args[1],
			);
			const steps = ceremonySteps(ceremony);
			if (values.json) {
				rt.out(
					JSON.stringify(
						{
							id: ceremony.id,
							kind: "ceremony",
							owner: ceremony.owner,
							status: ceremony.status,
							venues: ceremony.venues.map((venue) => venue.venue),
							integrators: ceremony.integrators ?? [],
							createdAt: ceremony.createdAt,
							expiresAt: ceremony.expiresAt,
							keyPlan: ceremony.keyPlan ?? null,
							keyResult: ceremony.keyResult ?? null,
							steps: steps.map((step) => ({
								id: step.id,
								purpose: step.purpose,
								status: step.status,
								digest: step.digest,
							})),
						},
						null,
						2,
					),
				);
				return;
			}
			rt.out(ceremonyCard(ceremony, rt.now()));
			return;
		}
		rt.out(show(await store.get(args[1])));
		return;
	}
	if (args.length !== 1) throw new UsageError(`Usage: mob ${command} <id>`);
	const id = args[0];
	if (command === "reject") {
		rt.out(show(await store.reject(id)));
		return;
	}
	if (command === "preview") {
		const result = await store.preview(id, async (p) => {
			const result = await runPreflight(
				p,
				new MobiusClient({
					base: p.submit.base,
					version: pkg.version,
					fetch: rt.fetch,
				}),
				rt.now,
			);
			if (
				p.preflightPlan.checks.some(
					(c) => c.route === "staged" && c.name.startsWith("config."),
				)
			) {
				const checks = new Checks(rt.now);
				try {
					await configChecks(
						await readConfig(rt.home),
						checks,
						p.owner,
						p.kind === "api-submit",
					);
				} catch (error) {
					if (!(error instanceof CheckFailure)) throw error;
				}
				result.checks = result.checks.map(
					(c) => checks.checks.find((fresh) => fresh.name === c.name) ?? c,
				);
				result.ok = result.checks.every((c) => c.ok);
				result.checkedAt = rt.now();
			}
			return result;
		});
		rt.out(show(result));
		if (!result.preflight?.ok)
			throw new Error("Preflight rejected the Proposal");
		if (!values.json)
			rt.out(
				result.kind === "api-submit"
					? `Stopped before submission. Next: mob submit ${id}.`
					: `Stopped before signing. To authorize this Proposal, name ${id} and run mob sign ${id}.`,
			);
		return;
	}
	const stored = await store.get(id);
	if (await refreshExpired(stored, rt)) return;
	if (stored.status === "expired" && (await restageProposal(id, rt))) return;
	const proposal = await store.assertSignable(id);
	if (proposal.kind === "api-submit")
		throw new UsageError(`Use mob submit ${id} for this API Proposal`);
	const config = await readConfig(rt.home);
	if ((config.policy ?? "manual") !== "manual")
		throw new UsageError("Wallet policy is locked");
	const backend = values.with ?? config.signer;
	if (!backend)
		throw new UsageError(config.owner ? chooseSigner(id) : SETUP_FIRST);
	if (
		backend !== "keystore" &&
		backend !== "browser" &&
		backend !== "walletconnect"
	)
		throw new UsageError(`${backend} signer is not available in this build`);
	if (backend === "walletconnect" && !config.walletconnect_project_id)
		throw new UsageError(
			"Set walletconnect_project_id with mob config set walletconnect_project_id <Reown project ID>",
		);
	if (!config.owner) throw new UsageError(SETUP_FIRST);
	// The server shows a created key once: check that the store can keep it
	// before the wallet signs, and again just before submission.
	if (proposal.submit.onAnswer === "store-api-key")
		await requireWritableKeyStore(rt, proposal.owner);
	let close: (() => Promise<void>) | undefined;
	let waiting: ReturnType<typeof walletWait> | undefined;
	const cancellation = new AbortController();
	const cancel = () => {
		cancellation.abort(new Error("Signing cancelled"));
		waiting?.stop();
	};
	// A caller that supplies a signal owns cancellation. Bun 1.3.8 drops the
	// native handler when a listener is removed, which would strip a long-lived
	// caller (the approver) of its own Ctrl-C handling.
	if (!rt.signal) {
		process.on("SIGINT", cancel);
		process.on("SIGTERM", cancel);
	}
	rt.signal?.addEventListener("abort", cancel, { once: true });
	if (rt.signal?.aborted) cancel();
	const checkConfig = async () => {
		const latest = await readConfig(rt.home);
		if (
			(latest.policy ?? "manual") !== "manual" ||
			latest.owner?.toLowerCase() !== config.owner?.toLowerCase()
		)
			throw new Error(
				"Owner or policy changed while waiting for wallet; sign was cancelled",
			);
	};
	try {
		const result = await store.sign(id, {
			signal: cancellation.signal,
			owner: getAddress(config.owner),
			policy: "manual",
			// Only in-process callers (the approver) can pass a pinned record hash.
			expectContentHash:
				typeof values.pin === "string"
					? (values.pin as `0x${string}`)
					: undefined,
			display: (p) => {
				if (backend === "keystore" || rt.stdoutIsTTY)
					rt.out(showProposal(p, rt.now(), rt));
			},
			connect: async (proposal) => {
				cancellation.signal.throwIfAborted();
				waiting = walletWait(rt, proposal.expiresAt);
				let signer: Signer;
				if (backend === "browser") {
					const browser = browserSigner(proposal, {
						openUrl: rt.openUrl,
						now: rt.now,
						onUrl: (url) => waiting?.show(url, "browser"),
					});
					close = () => browser.close();
					signer = browser;
				} else if (backend === "walletconnect") {
					const wallet = walletConnectSigner(proposal, {
						projectId: config.walletconnect_project_id as string,
						now: rt.now,
						createClient: rt.walletConnectClientFactory,
						onPairing: (uri) => waiting?.show(uri, "walletconnect"),
					});
					close = () => wallet.close();
					signer = wallet;
				} else {
					signer = await unlockKeystore(
						rt.home,
						config.owner as string,
						(prompt) => read(prompt, cancellation.signal),
					);
					close = async () => {
						await signer.close?.();
					};
				}
				return {
					async address() {
						const address = await signer.address();
						await checkConfig();
						await rememberSigner(String(backend), config, rt);
						return address;
					},
					async signMessage(args) {
						await checkConfig();
						cancellation.signal.throwIfAborted();
						return signer.signMessage(args);
					},
					async signTypedData(args) {
						await checkConfig();
						cancellation.signal.throwIfAborted();
						return signer.signTypedData(args);
					},
				};
			},
			submit: async (p, body) => {
				waiting?.stop();
				await checkConfig();
				cancellation.signal.throwIfAborted();
				if (rt.now() >= p.expiresAt)
					throw new Error("Proposal expired before submission");
				if (!p.submit.route.startsWith("/api/keys/")) {
					const answer = await submitPlan(p, body, rt);
					if (
						p.submit.onAnswer === "store-agent-grant" ||
						p.submit.onAnswer === "revoke-agent-grant"
					) {
						const { recordGrantAnswer } = await import("./grant-command.ts");
						await recordGrantAnswer(rt, p, answer);
					}
					return answer;
				}
				if (p.submit.onAnswer === "store-api-key")
					await requireWritableKeyStore(rt, p.owner);
				let answer: Json;
				try {
					const client = new MobiusClient({
						base: p.submit.base,
						version: pkg.version,
						fetch: rt.fetch,
					});
					const signal = AbortSignal.timeout(
						Math.max(1, p.expiresAt - rt.now()),
					);
					if (p.submit.route === "/api/keys/create")
						answer = (await client.write(
							"/api/keys/create",
							body as unknown as ApiKeyCreateBody,
							signal,
						)) as unknown as Json;
					else if (p.submit.route === "/api/keys/list")
						answer = (await client.write(
							"/api/keys/list",
							body as unknown as ApiKeyListBody,
							signal,
						)) as unknown as Json;
					else
						answer = await client.write(
							"/api/keys/revoke",
							body as unknown as ApiKeyRevokeBody,
							signal,
						);
				} catch (error) {
					throw new Error(
						redactKey(error instanceof Error ? error.message : String(error)),
					);
				}
				if (p.submit.onAnswer !== "store-api-key") return answer;
				return storeCreatedKey(rt, p.owner, p.submit.body, answer);
			},
		});
		if (result.submit.route === "/api/keys/create") {
			const answer = object(result.answer);
			const prefix = String(answer.key);
			const backendName = String(answer.backend);
			rt.out(`Key ${prefix} stored in ${backendName}.`);
		} else if (result.submit.route === "/api/keys/list") {
			rt.out(keyListTable(result.answer));
		} else if (result.submit.route === "/api/keys/revoke") {
			const keyStore = await cliKeyStore(rt);
			const stored = await keyStore.get(result.owner);
			const revoked = String(result.submit.body.id);
			const localUuid = stored?.key.slice(
				"mobius_".length,
				stored.key.indexOf("."),
			);
			const removed =
				localUuid === revoked ? await keyStore.delete(result.owner) : false;
			rt.out(
				`Key mobius_${revoked}… revoked.${removed ? " Matching local key deleted." : " No matching local key was stored."}`,
			);
		} else
			rt.out(
				publicText(
					`${result.id}: ${result.status} · Server answer: ${JSON.stringify(result.answer)} · Submission is acknowledged; execution is not confirmed.`,
				),
			);
	} catch (error) {
		waiting?.stop();
		if (error instanceof Error && error.message === "TTY input cancelled")
			cancel();
		if (cancellation.signal.aborted) {
			await close?.();
			const saved = await store.get(id);
			if (!saved.signature) {
				rt.out(
					`Cancelled. ${id} is still awaiting signature until ${new Date(proposal.expiresAt).toISOString()}.`,
				);
				if (saved.status === "interrupted")
					rt.out(
						`The signing attempt was interrupted. Run mob reject ${id}, then stage a fresh Proposal.`,
					);
			} else
				rt.out(
					`Cancelled. ${id} is ${saved.status}; run mob status to check the result.`,
				);
			return;
		}
		if (
			error instanceof ApiError &&
			error.status === 409 &&
			(await store.get(id)).submit.route === "/legal/acceptance"
		) {
			rt.out(
				"Legal terms changed. The old Proposal cannot be signed again; staging current terms for new approval.",
			);
			const { stageLegal } = await import("./setup-command.ts");
			await stageLegal(rt, true);
		}
		// Key and legal Proposals get the explained message; trading Proposals
		// keep MoB's structured answer, which the agent reads verbatim.
		throw /^\/(?:api\/keys|legal)\//.test(proposal.submit.route)
			? explainCeremonyFailure(error, {
					id,
					owner: proposal.owner,
					restage: restageFor(proposal),
				})
			: error;
	} finally {
		if (!rt.signal) {
			process.off("SIGINT", cancel);
			process.off("SIGTERM", cancel);
		}
		rt.signal?.removeEventListener("abort", cancel);
		waiting?.stop();
		await close?.();
	}
}
