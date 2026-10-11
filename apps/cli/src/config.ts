import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_TAKER_FEE_BPS } from "@mstack/opportunities";

export interface Config {
	signer?: "keystore" | "browser" | "walletconnect";
	policy?: "locked" | "manual";
	api_base?: string;
	auth_base?: string;
	legal_chain_id?: number;
	hl_signature_chain_id?: string;
	owner?: string;
	default_size_usd?: number;
	taker_fee_bps?: Record<string, number>;
	builder_fee_tenths_bps?: number;
}

export class UsageError extends Error {}

export function ownerAddress(value: string): string {
	if (!/^0x[0-9a-fA-F]{40}$/.test(value))
		throw new UsageError("owner must be a 20-byte 0x address");
	return value;
}

export function apiBase(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new UsageError("api_base must be an absolute HTTP(S) URL");
	}
	if (
		!["https:", "http:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		throw new UsageError(
			"api_base must be an HTTP(S) URL without credentials, query, or fragment",
		);
	return url.href.replace(/\/$/, "");
}

export function numberFlag(
	value: string | number,
	name: string,
	minimum: number,
	integer = false,
): number {
	if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(String(value)))
		throw new UsageError(`${name} must be a number`);
	const result = Number(value);
	if (
		!Number.isFinite(result) ||
		result < minimum ||
		(integer && !Number.isSafeInteger(result))
	)
		throw new UsageError(
			`${name} must be ${integer ? "an integer" : "finite"} >= ${minimum}`,
		);
	return result;
}

function knownKey(key: string): void {
	if (
		[
			"signer",
			"policy",
			"api_base",
			"auth_base",
			"legal_chain_id",
			"hl_signature_chain_id",
			"owner",
			"default_size_usd",
			"builder_fee_tenths_bps",
		].includes(key)
	)
		return;
	if (
		key.startsWith("taker_fee_bps.") &&
		Object.hasOwn(DEFAULT_TAKER_FEE_BPS, key.slice(14))
	)
		return;
	throw new UsageError(`Unknown config key ${key}`);
}

export function parsedValue(
	key: string,
	value: string | number,
): string | number {
	knownKey(key);
	if (key === "signer" || key === "policy") {
		const allowed =
			key === "signer"
				? ["keystore", "browser", "walletconnect"]
				: ["locked", "manual"];
		if (!allowed.includes(String(value)))
			throw new UsageError(`Invalid ${key}: expected ${allowed.join(" | ")}`);
		return String(value);
	}
	if (key === "api_base" || key === "auth_base") return apiBase(String(value));
	if (key === "legal_chain_id") return numberFlag(value, key, 1, true);
	if (key === "hl_signature_chain_id") {
		if (
			!/^0x[0-9a-f]+$/i.test(String(value)) ||
			!Number.isSafeInteger(Number(value)) ||
			Number(value) <= 0
		)
			throw new UsageError(
				"hl_signature_chain_id must be a positive safe hex chain id",
			);
		return `0x${Number(value).toString(16)}`;
	}
	if (key === "owner") return ownerAddress(String(value));
	const result = numberFlag(value, key, 0, key === "builder_fee_tenths_bps");
	if (key === "default_size_usd" && result === 0)
		throw new UsageError("default_size_usd must be positive");
	return result;
}

export function configHome(): string {
	return process.env.MOB_HOME ?? join(homedir(), ".mob");
}

export async function readConfig(home = configHome()): Promise<Config> {
	let raw: string;
	try {
		raw = await readFile(join(home, "config.json"), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
	const value: unknown = JSON.parse(raw);
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Config must be an object");
	for (const [key, item] of Object.entries(value)) {
		if (key === "taker_fee_bps") {
			if (!item || typeof item !== "object" || Array.isArray(item))
				throw new Error("taker_fee_bps must be an object");
			for (const [venue, fee] of Object.entries(item)) {
				if (typeof fee !== "number")
					throw new Error(`Invalid fee for ${venue}`);
				parsedValue(`taker_fee_bps.${venue}`, fee);
			}
		} else {
			if (
				typeof item !==
				([
					"api_base",
					"auth_base",
					"hl_signature_chain_id",
					"owner",
					"signer",
					"policy",
				].includes(key)
					? "string"
					: "number")
			)
				throw new Error(`Invalid config value for ${key}`);
			parsedValue(key, item as string | number);
		}
	}
	return value as Config;
}

export function getConfig(config: Config, key: string): string | number {
	knownKey(key);
	if (key === "auth_base")
		return config.auth_base ?? "https://auth.mob.exchange";
	if (key === "legal_chain_id") return config.legal_chain_id ?? 97;
	if (key === "hl_signature_chain_id")
		return config.hl_signature_chain_id ?? "0xa4b1";
	if (key === "policy") return config.policy ?? "manual";
	if (key === "signer") return config.signer ?? "";
	if (key === "owner") return config.owner ?? "";
	if (key === "api_base")
		return config.api_base ?? "https://funding.mob.exchange";
	if (key === "default_size_usd") return config.default_size_usd ?? 1000;
	if (key === "builder_fee_tenths_bps")
		return config.builder_fee_tenths_bps ?? 15;
	const venue = key.slice(14);
	return config.taker_fee_bps?.[venue] ?? DEFAULT_TAKER_FEE_BPS[venue];
}

export async function setConfig(
	key: string,
	value: string,
	home = configHome(),
): Promise<string | number> {
	const parsed = parsedValue(key, value);
	const config = await readConfig(home);
	if (key.startsWith("taker_fee_bps."))
		config.taker_fee_bps = {
			...config.taker_fee_bps,
			[key.slice(14)]: parsed as number,
		};
	else Object.assign(config, { [key]: parsed });
	await mkdir(home, { recursive: true, mode: 0o700 });
	const temporary = join(
		home,
		`config.${process.pid}.${crypto.randomUUID()}.tmp`,
	);
	await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
		mode: 0o600,
		flag: "wx",
	});
	await chmod(temporary, 0o600);
	await rename(temporary, join(home, "config.json"));
	return parsed;
}
