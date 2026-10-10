import { ApiError, MobiusClient } from "@mstack/mobius-client";
import { ProposalStore, runPreflight } from "@mstack/proposals";
import {
	browserSigner,
	createKeystore,
	importKeystore,
	listKeystores,
	pairingQr,
	readSecretFromTty,
	type SecretReader,
	type Signer,
	unlockKeystore,
	walletConnectSigner,
} from "@mstack/signers";
import { getAddress } from "viem";
import pkg from "../package.json";
import { readConfig, UsageError } from "./config.ts";
import { submitPlan } from "./onboarding-http.ts";
import { CheckFailure, Checks, configChecks } from "./preflight/checks.ts";
import { showProposal } from "./proposal-view.ts";
import type { Runtime } from "./run.ts";

export async function p1(
	command: string,
	args: string[],
	values: Record<string, string | boolean | undefined>,
	rt: Runtime,
	read: SecretReader = readSecretFromTty,
): Promise<void> {
	const store = new ProposalStore(rt.home, rt.now);
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
		rt.out(
			proposals.map((p) => `${p.id}\t${p.status}\t${p.purpose}`).join("\n") ||
				"No proposals.",
		);
		return;
	}
	if (command === "proposal") {
		if (args.length !== 2 || args[0] !== "show")
			throw new UsageError("Usage: mob proposal show <id>");
		rt.out(showProposal(await store.get(args[1])));
		return;
	}
	if (args.length !== 1) throw new UsageError(`Usage: mob ${command} <id>`);
	const id = args[0];
	if (command === "reject") {
		rt.out(showProposal(await store.reject(id)));
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
					await configChecks(await readConfig(rt.home), checks, p.owner);
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
		rt.out(showProposal(result));
		if (!result.preflight?.ok)
			throw new Error("Preflight rejected the Proposal");
		rt.out(
			`Stopped before signing. To authorize this Proposal, name ${id} and run mob sign ${id}.`,
		);
		return;
	}
	const config = await readConfig(rt.home);
	const backend = values.with ?? config.signer;
	if (!backend)
		throw new UsageError("Set signer with mob config set signer keystore");
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
	if (!config.owner)
		throw new UsageError("Set owner with mob config set owner 0x…");
	let close: (() => Promise<void>) | undefined;
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
			owner: getAddress(config.owner),
			policy: config.policy ?? "manual",
			display: (p) => rt.out(showProposal(p)),
			connect: async (proposal) => {
				let signer: Signer;
				if (backend === "browser") {
					const browser = browserSigner(proposal, {
						openUrl: rt.openUrl,
						now: rt.now,
						onUrl: (url) =>
							rt.out(`Open this URL in your wallet browser: ${url}`),
					});
					close = () => browser.close();
					signer = browser;
				} else if (backend === "walletconnect") {
					const wallet = walletConnectSigner(proposal, {
						projectId: config.walletconnect_project_id as string,
						now: rt.now,
						createClient: rt.walletConnectClientFactory,
						onPairing: (uri) =>
							rt.out(
								`Scan with your WalletConnect wallet:\n${pairingQr(uri)}\n${uri}\nApprove only the owner and message shown above. Expires: ${new Date(proposal.expiresAt).toISOString()}`,
							),
					});
					close = () => wallet.close();
					signer = wallet;
				} else
					signer = await unlockKeystore(rt.home, config.owner as string, read);
				return {
					async address() {
						const address = await signer.address();
						await checkConfig();
						return address;
					},
					async signMessage(args) {
						await checkConfig();
						return signer.signMessage(args);
					},
					async signTypedData(args) {
						await checkConfig();
						return signer.signTypedData(args);
					},
				};
			},
			submit: async (p, body) => {
				await checkConfig();
				if (rt.now() >= p.expiresAt)
					throw new Error("Proposal expired before submission");
				return submitPlan(p, body, rt);
			},
		});
		rt.out(
			`${result.id}: ${result.status}\nServer answer: ${JSON.stringify(result.answer)}\nSubmission is acknowledged; execution is not confirmed.`,
		);
	} catch (error) {
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
		throw error;
	} finally {
		await close?.();
	}
}
