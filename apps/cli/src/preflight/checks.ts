import type { MobiusClient } from "@mstack/mobius-client";
import type {
	PreflightCheck,
	PreflightResult,
	ReadCheck,
} from "@mstack/proposals";
import { canonical } from "@mstack/proposals";
import type { Config } from "../config.ts";

export type Reader = Pick<MobiusClient, "read">;
export interface Checked extends PreflightResult {
	plan: PreflightCheck[];
}

/** Captures each named check once, in order. A failure stops the preflight. */
export class Checks {
	readonly plan: PreflightCheck[] = [];
	readonly checks: PreflightResult["checks"] = [];
	constructor(readonly now: () => number) {}
	async fact(
		name: string,
		operation: () => string | Promise<string>,
	): Promise<void> {
		try {
			const detail = await operation();
			this.plan.push({ route: "staged", name, detail });
			this.checks.push({ route: "staged", name, detail, ok: true });
		} catch (error) {
			this.fail("staged", name, error);
		}
	}
	fail(route: string, name: string, error: unknown): never {
		const message = error instanceof Error ? error.message : String(error);
		this.checks.push({ route, name, ok: false, error: message });
		throw new CheckFailure(`${name}: ${message}`);
	}
	async read(check: ReadCheck, reader: Reader): Promise<void> {
		try {
			const answer = await reader.read(check.route, check.params);
			for (const assertion of check.assertions) {
				let value: unknown = answer;
				for (const field of assertion.path) {
					if (
						!value ||
						typeof value !== "object" ||
						!Object.hasOwn(value, field)
					)
						throw new Error(`Missing ${assertion.path.join(".")}`);
					value = (value as Record<string, unknown>)[field];
				}
				if (
					"remainingMs" in assertion
						? typeof value !== "number" ||
							value <= this.now() + assertion.remainingMs
						: canonical(value) !== canonical(assertion.equals)
				)
					throw new Error(`Changed ${assertion.path.join(".")}`);
			}
			this.recordRead(check);
		} catch (error) {
			this.fail(check.route, check.name ?? check.route, error);
		}
	}
	recordRead(check: ReadCheck): void {
		this.plan.push(check);
		this.checks.push({
			route: check.route,
			...(check.name ? { name: check.name } : {}),
			ok: true,
		});
	}
	result(): Checked {
		return {
			ok: this.checks.every((c) => c.ok),
			checkedAt: this.now(),
			checks: this.checks,
			plan: this.plan,
		};
	}
}
export class CheckFailure extends Error {}
export function requireValue(
	condition: unknown,
	message: string,
): asserts condition {
	if (!condition) throw new Error(message);
}
export async function configChecks(
	config: Config,
	checks: Checks,
	expectedOwner?: string,
): Promise<void> {
	await checks.fact("config.owner", () => {
		requireValue(
			config.owner && /^0x[0-9a-fA-F]{40}$/.test(config.owner),
			"Set owner with mob config set owner 0x…",
		);
		requireValue(
			!expectedOwner ||
				config.owner.toLowerCase() === expectedOwner.toLowerCase(),
			"Configured owner does not match Proposal owner",
		);
		return config.owner;
	});
	await checks.fact("config.signer", () => {
		requireValue(
			["keystore", "browser", "walletconnect"].includes(config.signer ?? ""),
			"Configure an available signer: keystore, browser or walletconnect",
		);
		if (config.signer === "walletconnect")
			requireValue(
				config.walletconnect_project_id &&
					/^[a-f0-9]{32}$/i.test(config.walletconnect_project_id),
				"Set walletconnect_project_id to your Reown project ID",
			);
		return config.signer as string;
	});
	await checks.fact("config.policy", () => {
		requireValue(
			(config.policy ?? "manual") === "manual",
			"Wallet policy is locked",
		);
		return "manual";
	});
}
