import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { type ArbitrageVenue, MobiusClient } from "@mstack/mobius-client";
import { ProposalStore } from "@mstack/proposals";
import pkg from "../package.json";
import { type Config, getConfig, readConfig } from "./config.ts";
import { object, request } from "./onboarding-http.ts";
import { credentialReadiness } from "./preflight/readiness.ts";
import { API_BUDGET_MS, reachability } from "./reachability.ts";
import type { Runtime } from "./run.ts";
import { installationRoot } from "./upgrade.ts";

export type Reading<T> = {
	state: "ok" | "slow" | "unreachable" | "not checked";
	value?: T;
	error?: string;
};
const unchecked = <T>(): Reading<T> => ({ state: "not checked" });
const failure = (error: unknown) =>
	error instanceof Error ? error.message : String(error);
export const homeVenues = [
	"hl",
	"lighter",
	"aster",
	"lighter-mainnet",
] as const;
type Venue = { bound: boolean; ready: boolean; issue?: string };
export interface HomeData {
	version: string;
	config: { path: string; present: boolean; valid: boolean; error?: string };
	owner: string | null;
	signer: Config["signer"] | null;
	policy: string;
	api: Reading<{ latencyMs: number }> & { host: string };
	auth: Reading<{ latencyMs: number }> & { host: string };
	legal: Reading<{ accepted: boolean; acceptedAt: string | null }>;
	venues: Record<ArbitrageVenue, Reading<Venue>>;
	tasks: Reading<Record<string, number>>;
	proposals: Reading<{ awaiting: string[]; expired: string[] }>;
	upgrade: Reading<{ available: string | null }>;
	diagnostics: {
		bun: boolean;
		signer: { usable: boolean; detail: string };
		hlDeposit: Reading<boolean>;
		lighterAccounts: Record<"lighter" | "lighter-mainnet", Reading<boolean>>;
	};
	next: string;
}
export interface HomeServices {
	networkBudgetMs?: number;
	which?: (command: string) => string | null;
	platform?: NodeJS.Platform;
	upgrade?: () => Promise<Reading<{ available: string | null }>>;
}

async function exists(path: string) {
	try {
		return await lstat(path);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw e;
	}
}
async function cachedUpgrade(): Promise<Reading<{ available: string | null }>> {
	const root = await installationRoot();
	if (!root) return unchecked();
	async function git(args: string[]) {
		const p = Bun.spawn(["git", "-C", root as string, ...args], {
			stdout: "pipe",
			stderr: "ignore",
		});
		const timer = setTimeout(() => p.kill(), 1000);
		try {
			const [code, output] = await Promise.all([
				p.exited,
				new Response(p.stdout).text(),
			]);
			return { code, output: output.trim() };
		} finally {
			clearTimeout(timer);
		}
	}
	const [head, remote] = await Promise.all([
		git(["rev-parse", "HEAD"]),
		git(["rev-parse", "refs/remotes/origin/main"]),
	]);
	if (head.code || remote.code) return unchecked();
	if (head.output === remote.output)
		return { state: "ok", value: { available: null } };
	// A local commit ahead of main is not an available upgrade. Never fetch here.
	const ahead = await git([
		"merge-base",
		"--is-ancestor",
		head.output,
		remote.output,
	]);
	if (ahead.code > 1) return unchecked();
	return {
		state: "ok",
		value: { available: ahead.code === 0 ? remote.output.slice(0, 7) : null },
	};
}
async function signerStatus(
	config: Config,
	home: string,
	services: HomeServices,
) {
	if (config.signer === "browser") {
		const platform = services.platform ?? process.platform;
		const opener =
			platform === "darwin"
				? "open"
				: platform === "win32"
					? "cmd"
					: "xdg-open";
		const usable = Boolean((services.which ?? Bun.which)(opener));
		return { usable, detail: `${opener} ${usable ? "present" : "missing"}` };
	}
	if (config.signer === "walletconnect")
		return {
			usable: Boolean(config.walletconnect_project_id),
			detail: config.walletconnect_project_id
				? "project id set"
				: "walletconnect_project_id not set",
		};
	if (config.signer === "keystore" && config.owner) {
		const file = await exists(
			join(home, "keystore", `${config.owner.toLowerCase()}.json`),
		);
		const usable = Boolean(file?.isFile() && (file.mode & 0o777) === 0o600);
		return {
			usable,
			detail: usable
				? "keystore file exists; mode 0600"
				: "keystore missing or not a regular file with mode 0600",
		};
	}
	return { usable: false, detail: "not set → run mob setup" };
}

export async function collectHome(
	rt: Runtime,
	options: { offline?: boolean; doctor?: boolean } = {},
): Promise<HomeData> {
	const services = rt.homeServices ?? {};
	const path = join(rt.home, "config.json");
	let config: Config = {};
	let configError: string | undefined;
	let present = false;
	try {
		present = Boolean(await exists(path));
		config = await readConfig(rt.home);
	} catch (e) {
		configError = failure(e);
	}
	const apiBase = String(getConfig(config, "api_base"));
	const authBase = String(getConfig(config, "auth_base"));
	const data: HomeData = {
		version: pkg.version,
		config: {
			path,
			present,
			valid: !configError,
			...(configError ? { error: configError } : {}),
		},
		owner: config.owner ?? null,
		signer: config.signer ?? null,
		policy: String(getConfig(config, "policy")),
		api: { host: new URL(apiBase).host, ...unchecked() },
		auth: { host: new URL(authBase).host, ...unchecked() },
		legal: unchecked(),
		venues: {
			hl: unchecked(),
			lighter: unchecked(),
			aster: unchecked(),
			"lighter-mainnet": unchecked(),
		},
		tasks: unchecked(),
		proposals: unchecked(),
		upgrade: unchecked(),
		diagnostics: {
			bun: Boolean((services.which ?? Bun.which)("bun")),
			signer: { usable: false, detail: "not checked" },
			hlDeposit: unchecked(),
			lighterAccounts: { lighter: unchecked(), "lighter-mainnet": unchecked() },
		},
		next: "mob setup",
	};
	try {
		data.diagnostics.signer = await signerStatus(config, rt.home, services);
	} catch (e) {
		data.diagnostics.signer = { usable: false, detail: failure(e) };
	}
	try {
		const proposals = (await exists(join(rt.home, "proposals")))
			? await new ProposalStore(rt.home, rt.now).list()
			: [];
		const pending = proposals.filter((p) =>
			["staged", "previewed", "awaiting-signature", "expired"].includes(
				p.status,
			),
		);
		data.proposals = {
			state: "ok",
			value: {
				awaiting: pending
					.filter(
						(p) =>
							p.status === "awaiting-signature" &&
							p.signatureAttemptedAt === undefined &&
							p.expiresAt > rt.now(),
					)
					.map((p) => p.id),
				expired: pending
					.filter((p) => p.status === "expired" || p.expiresAt <= rt.now())
					.map((p) => p.id),
			},
		};
	} catch (e) {
		data.proposals = { state: "unreachable", error: failure(e) };
	}
	const controller = new AbortController();
	const signal = rt.signal
		? AbortSignal.any([controller.signal, rt.signal])
		: controller.signal;
	const jobs: Promise<void>[] = [];
	function read<T>(job: () => Promise<T>, accept: (value: Reading<T>) => void) {
		jobs.push(
			(async () => {
				try {
					const value = await job();
					if (!signal.aborted) accept({ state: "ok", value });
				} catch (e) {
					if (!signal.aborted)
						accept({ state: "unreachable", error: failure(e) });
				}
			})(),
		);
	}
	read(services.upgrade ?? cachedUpgrade, (result) => {
		data.upgrade = result.value ?? { state: result.state, error: result.error };
	});
	if (!options.offline && !configError && !signal.aborted) {
		const client = new MobiusClient({
			base: apiBase,
			version: pkg.version,
			fetch: rt.fetch,
		});
		const auth = new MobiusClient({
			base: authBase,
			version: pkg.version,
			fetch: rt.fetch,
		});
		read(
			async () => {
				const start = performance.now();
				await request(
					rt.fetch,
					`${apiBase}/api/client-ip`,
					"GET",
					undefined,
					signal,
				);
				return { latencyMs: Math.round(performance.now() - start) };
			},
			(value) => {
				data.api = { host: data.api.host, ...value };
				if (value.value) data.api.state = reachability(value.value.latencyMs);
			},
		);
		read(
			async () => {
				const start = performance.now();
				if (config.owner) {
					const legal = await auth.read(
						"/legal/acceptance",
						{ wallet: config.owner },
						signal,
					);
					if (
						legal.acceptedAt !== null &&
						!Number.isFinite(Date.parse(legal.acceptedAt))
					)
						throw new Error("Malformed legal acceptedAt");
					if (!signal.aborted) data.legal = { state: "ok", value: legal };
				} else await auth.read("/legal/terms", {}, signal);
				return { latencyMs: Math.round(performance.now() - start) };
			},
			(value) => {
				data.auth = { host: data.auth.host, ...value };
				if (value.value) data.auth.state = reachability(value.value.latencyMs);
				if (value.state === "unreachable")
					data.legal = { state: "unreachable", error: value.error };
			},
		);
		const owner = config.owner;
		if (owner) {
			for (const venue of homeVenues)
				read(
					async () => {
						const credential =
							venue === "hl"
								? await client.read(
										"/api/binding/hl/credential",
										{ ownerAddress: owner },
										signal,
									)
								: venue === "aster"
									? await client.read(
											"/api/binding/aster/credential",
											{ ownerAddress: owner },
											signal,
										)
									: await client.read(
											"/api/binding/lighter/credential",
											{ ownerAddress: owner, venue },
											signal,
										);
						return {
							bound: credential.bound,
							...credentialReadiness(venue, credential, rt.now()),
						};
					},
					(value) => {
						data.venues[venue] = value;
					},
				);
			read(
				async () => {
					const tasks = await client.read(
						"/api/arbitrage/list",
						{ owner },
						signal,
					);
					const counts: Record<string, number> = {};
					for (const task of tasks)
						counts[task.status] = (counts[task.status] ?? 0) + 1;
					return counts;
				},
				(value) => {
					data.tasks = value;
				},
			);
			if (options.doctor) {
				read(
					async () => {
						const state = object(
							await request(
								rt.fetch,
								"https://api.hyperliquid.xyz/info",
								"POST",
								{ type: "clearinghouseState", user: owner },
								signal,
							),
						);
						const value = object(state.marginSummary).accountValue;
						if (
							typeof value !== "string" ||
							!value.trim() ||
							!Number.isFinite(Number(value))
						)
							throw new Error("Malformed HL accountValue");
						return Number(value) > 0;
					},
					(value) => {
						data.diagnostics.hlDeposit = value;
					},
				);
				for (const venue of ["lighter", "lighter-mainnet"] as const)
					read(
						async () => {
							const rest =
								venue === "lighter"
									? "https://api.rh.lighter.xyz"
									: "https://mainnet.zklighter.elliot.ai";
							const result = object(
								await request(
									rt.fetch,
									`${rest}/api/v1/account?by=l1_address&value=${owner}`,
									"GET",
									undefined,
									signal,
								),
							);
							if (result.code !== 200 || !Array.isArray(result.accounts))
								throw new Error("Malformed Lighter account response");
							for (const account of result.accounts) {
								const index = object(account).index;
								if (
									typeof index !== "number" ||
									!Number.isSafeInteger(index) ||
									index < 0
								)
									throw new Error("Malformed Lighter account index");
							}
							return result.accounts.length > 0;
						},
						(value) => {
							data.diagnostics.lighterAccounts[venue] = value;
						},
					);
			}
		}
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	let finishAbort: (() => void) | undefined;
	try {
		await Promise.race([
			Promise.all(jobs),
			new Promise<void>((resolve) => {
				finishAbort = () => resolve();
				signal.addEventListener("abort", finishAbort, { once: true });
				timer = setTimeout(
					() => controller.abort(new Error("Home network budget expired")),
					services.networkBudgetMs ?? API_BUDGET_MS,
				);
				if (signal.aborted) resolve();
			}),
		]);
	} finally {
		clearTimeout(timer);
		if (finishAbort) signal.removeEventListener("abort", finishAbort);
		controller.abort();
	}
	if (!options.offline && !configError) {
		for (const target of [data.api, data.auth])
			if (target.state === "not checked") target.state = "unreachable";
	}
	const awaiting = data.proposals.value?.awaiting[0];
	data.next = awaiting
		? `mob sign ${awaiting}`
		: !present || configError
			? "mob setup"
			: homeVenues.some((venue) => data.venues[venue].value?.bound)
				? "mob scan --size 1000"
				: "mob bind hl";
	return data;
}
