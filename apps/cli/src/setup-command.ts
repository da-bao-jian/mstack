import { createInterface } from "node:readline";
import {
	ACCEPT_LEGAL_TERMS_PRIMARY_TYPE,
	ACCEPT_LEGAL_TERMS_STATEMENT,
	ACCEPT_LEGAL_TERMS_TYPES,
	ApiError,
	LEGAL_EIP712_DOMAIN_NAME,
	LEGAL_EIP712_DOMAIN_VERSION,
	MobiusClient,
} from "@mstack/mobius-client";
import {
	type JsonObject,
	type ProposalInput,
	ProposalStore,
} from "@mstack/proposals";
import { getAddress } from "viem";
import pkg from "../package.json";
import { getConfig, parsedValue, readConfig, setConfig } from "./config.ts";
import { cliKeyStore } from "./key-store.ts";
import { printStaged, stageOnboarding } from "./onboarding-stage.ts";
import type { Runtime } from "./run.ts";

export interface LegalPlan {
	base: string;
	signing: Extract<ProposalInput["signing"], { type: "typed" }>;
	body: JsonObject;
	detail: string;
}

/**
 * Builds the typed legal acceptance for the configured owner, or reports that
 * it is already accepted, blocked by policy, or not configured on the server.
 */
export async function legalPlan(
	rt: Runtime,
	fresh = false,
): Promise<LegalPlan | "accepted" | "locked" | "unavailable"> {
	const config = await readConfig(rt.home);
	if (!config.owner) throw new Error("Setup requires an owner");
	const owner = getAddress(config.owner);
	const base = String(getConfig(config, "auth_base"));
	const client = new MobiusClient({
		base,
		version: pkg.version,
		fetch: rt.fetch,
	});
	try {
		if (
			!fresh &&
			(await client.read("/legal/acceptance", { wallet: owner })).accepted
		)
			return "accepted";
		if ((config.policy ?? "manual") === "locked") return "locked";
		const response = await client.read("/legal/terms", {});
		const terms = {
			termsVersion: response.termsVersion,
			termsUrl: response.termsUrl,
			privacyVersion: response.privacyVersion,
			privacyUrl: response.privacyUrl,
		};
		for (const key of ["termsUrl", "privacyUrl"] as const) {
			const url = new URL(terms[key]);
			if (url.protocol !== "https:" || url.username || url.password)
				throw new Error(`Invalid legal ${key}`);
		}
		const signedAt = Math.floor(rt.now() / 1000);
		return {
			base,
			signing: {
				type: "typed",
				typedData: {
					domain: {
						name: LEGAL_EIP712_DOMAIN_NAME,
						version: LEGAL_EIP712_DOMAIN_VERSION,
						chainId: Number(getConfig(config, "legal_chain_id")),
					},
					types: ACCEPT_LEGAL_TERMS_TYPES,
					primaryType: ACCEPT_LEGAL_TERMS_PRIMARY_TYPE,
					message: {
						statement: ACCEPT_LEGAL_TERMS_STATEMENT,
						wallet: owner,
						...terms,
						signedAt,
					},
				},
			},
			body: {
				wallet: owner,
				termsVersion: terms.termsVersion,
				privacyVersion: terms.privacyVersion,
				signedAt,
			},
			detail: `Terms ${terms.termsVersion}: ${terms.termsUrl}; privacy ${terms.privacyVersion}: ${terms.privacyUrl}`,
		};
	} catch (error) {
		if (error instanceof ApiError && error.status === 503) return "unavailable";
		throw error;
	}
}

export async function stageLegal(rt: Runtime, fresh = false) {
	const config = await readConfig(rt.home);
	if (!config.owner) throw new Error("Setup requires an owner");
	const owner = getAddress(config.owner);
	const base = String(getConfig(config, "auth_base"));
	const client = new MobiusClient({
		base,
		version: pkg.version,
		fetch: rt.fetch,
	});
	try {
		if (
			!fresh &&
			(await client.read("/legal/acceptance", { wallet: owner })).accepted
		) {
			rt.out("Current MoB legal terms already accepted.");
			return;
		}
		if ((config.policy ?? "manual") === "locked") {
			rt.out(
				"Policy is locked. Legal acceptance remains pending; no Proposal staged.",
			);
			return;
		}
		const response = await client.read("/legal/terms", {});
		const terms = {
			termsVersion: response.termsVersion,
			termsUrl: response.termsUrl,
			privacyVersion: response.privacyVersion,
			privacyUrl: response.privacyUrl,
		};
		for (const key of ["termsUrl", "privacyUrl"] as const) {
			const url = new URL(terms[key]);
			if (url.protocol !== "https:" || url.username || url.password)
				throw new Error(`Invalid legal ${key}`);
		}
		if (!fresh) {
			const history = await new ProposalStore(rt.home, rt.now, rt.err).list();
			const existing = history.findLast(
				(p) =>
					p.owner === owner &&
					p.submit.base === base &&
					p.submit.route === "/legal/acceptance" &&
					p.status === "awaiting-signature" &&
					p.expiresAt > rt.now() &&
					p.signing.type === "typed" &&
					p.signing.typedData.domain?.chainId ===
						Number(getConfig(config, "legal_chain_id")) &&
					JSON.stringify(p.signing.typedData.message) ===
						JSON.stringify({ ...p.signing.typedData.message, ...terms }),
			);
			const expired = history.findLast(
				(p) =>
					p.owner === owner &&
					p.submit.base === base &&
					p.submit.route === "/legal/acceptance" &&
					["expired", "interrupted"].includes(p.status),
			);
			if (!existing && expired)
				rt.out(
					`${expired.id} is ${expired.status}; staging a fresh legal Proposal.`,
				);
			if (existing) {
				printStaged(existing, rt);
				return;
			}
		}
		const signedAt = Math.floor(rt.now() / 1000);
		return await stageOnboarding(
			{
				kind: "sign-typed",
				owner,
				purpose: "Accept MoB legal terms",
				signing: {
					type: "typed",
					typedData: {
						domain: {
							name: LEGAL_EIP712_DOMAIN_NAME,
							version: LEGAL_EIP712_DOMAIN_VERSION,
							chainId: Number(getConfig(config, "legal_chain_id")),
						},
						types: ACCEPT_LEGAL_TERMS_TYPES,
						primaryType: ACCEPT_LEGAL_TERMS_PRIMARY_TYPE,
						message: {
							statement: ACCEPT_LEGAL_TERMS_STATEMENT,
							wallet: owner,
							...terms,
							signedAt,
						},
					},
				},
				submit: {
					base,
					route: "/legal/acceptance",
					signatureField: "signature",
					body: {
						wallet: owner,
						termsVersion: terms.termsVersion,
						privacyVersion: terms.privacyVersion,
						signedAt,
					},
				},
				preflightPlan: {
					checks: [
						{
							route: "staged",
							name: "legal.terms",
							detail: `Terms ${terms.termsVersion}: ${terms.termsUrl}; privacy ${terms.privacyVersion}: ${terms.privacyUrl}`,
						},
					],
				},
			},
			rt,
		);
	} catch (error) {
		if (error instanceof ApiError && error.status === 503) {
			rt.out(
				"Legal clickwrap is not configured on the auth server (503). Setup saved; acceptance not recorded.",
			);
			return;
		}
		throw error;
	}
}
export async function setupCommand(
	rt: Runtime,
	flags: Record<string, string | boolean | undefined> = {},
) {
	const current = await readConfig(rt.home);
	const required = ["owner", "signer", "policy"];
	const missing = required.filter((key) => flags[key] === undefined);
	const interactive = !!rt.stdinIsTTY && missing.length > 0;
	const needsProject = (flags.signer ?? current.signer) === "walletconnect";
	if (!rt.stdinIsTTY) {
		if (
			needsProject &&
			!flags["walletconnect-project-id"] &&
			!current.walletconnect_project_id
		)
			missing.push("walletconnect-project-id");
		if (missing.length)
			throw new Error(
				`Non-interactive setup requires: ${missing.map((key) => `--${key}`).join(", ")}`,
			);
	}
	const terminal =
		interactive && !rt.prompt
			? createInterface({
					input: process.stdin,
					crlfDelay: Infinity,
					terminal: false,
				})
			: undefined;
	const lines = terminal?.[Symbol.asyncIterator]();
	const ask =
		rt.prompt ??
		(async (question: string, value: string) => {
			process.stderr.write(`${question} [${value || "required"}]: `);
			const next = await lines?.next();
			if (!next || next.done)
				throw new Error("Setup input ended before all answers were supplied");
			return next.value.trim() || value;
		});
	try {
		const answers: [string, string][] = [];
		const fields = [
			["owner", "Owner"],
			["signer", "Signer (keystore | browser | walletconnect)"],
			["policy", "Policy (manual | locked)"],
			["auth_base", "Auth API base"],
			["legal_chain_id", "Legal signing chain id"],
		];
		for (const [index, [key, label]] of fields.entries()) {
			const fallback = String(getConfig(current, key));
			const supplied = flags[key.replaceAll("_", "-")];
			const answer =
				supplied !== undefined
					? String(supplied)
					: interactive
						? (
								await ask(`Setup · ${index + 1} of 5 · ${label}`, fallback)
							).trim() || fallback
						: fallback;
			parsedValue(key, answer);
			if (key === "owner") getAddress(answer);
			answers.push([key, answer]);
			if (key === "signer" && answer === "walletconnect") {
				const project =
					flags["walletconnect-project-id"] ??
					(interactive
						? await ask(
								"Setup · 2 of 5 · WalletConnect project ID",
								current.walletconnect_project_id ?? "",
							)
						: current.walletconnect_project_id);
				if (!project)
					throw new Error("Setup requires: --walletconnect-project-id");
				parsedValue("walletconnect_project_id", String(project));
				answers.push(["walletconnect_project_id", String(project)]);
			}
		}
		if (
			flags["walletconnect-project-id"] !== undefined &&
			!answers.some(([key]) => key === "walletconnect_project_id")
		) {
			const project = String(flags["walletconnect-project-id"]);
			parsedValue("walletconnect_project_id", project);
			answers.push(["walletconnect_project_id", project]);
		}
		const requestedPolicy = answers.find(([key]) => key === "policy")?.[1];
		if (requestedPolicy === "auto") {
			const requestedOwner = answers.find(([key]) => key === "owner")?.[1];
			const keyStore = await cliKeyStore(rt);
			if (
				!requestedOwner ||
				keyStore.backend === "env" ||
				!(await keyStore.get(requestedOwner))
			)
				throw new Error("Policy auto requires a stored key; run mob onboard");
		}
		for (const [key, value] of answers) await setConfig(key, value, rt.home);
		rt.out("Setup saved. No keystore was created.");
		if (requestedPolicy === "auto")
			rt.out(
				"Warning: policy auto lets the agent submit API-key Proposals inside the key's venue and size caps.",
			);
		if (
			answers.some(([key, value]) => key === "signer" && value === "keystore")
		)
			rt.out("Next step in your own terminal: mob keystore create");
		if (flags["no-legal"]) rt.out("Legal acceptance skipped (--no-legal).");
		else await stageLegal(rt);
	} finally {
		terminal?.close();
	}
}
