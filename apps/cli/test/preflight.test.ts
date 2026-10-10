import { expect, test } from "bun:test";
import type { MarketMetadata, ObservedFundingRate } from "@mstack/funding";
import { MobiusClient } from "@mstack/mobius-client";
import type { Proposal } from "@mstack/proposals";
import { runPreflight } from "@mstack/proposals";
import type { Config } from "../src/config.ts";
import { managePreflight } from "../src/preflight/manage.ts";
import {
	type OpenInput,
	openPreflight,
	quantizeLot,
} from "../src/preflight/open.ts";
import { bindingReadiness } from "../src/preflight/readiness.ts";
import { readyCredentials } from "./fixtures/fake-funding-server.ts";
import publicTask from "./fixtures/public-task.json";

const now = 1_800_000_000_000;
const owner = publicTask.owner;
const config: Config = { owner, signer: "browser", policy: "manual" };
const row = (venue: string): ObservedFundingRate => ({
	venue,
	market: "BTC",
	markPrice: 100_000,
	oiCapped: false,
	ratePerInterval: 0,
	intervalHours: 1,
	annualizedPct: 0,
	observedAt: now,
	source: "direct",
	annualizationMethod: "simple",
});
const meta = (venue: string): MarketMetadata => ({
	venue,
	market: "BTC",
	sizeDecimals: 3,
	lotSize: 0.001,
	minBase: 0.001,
	minNotionalUsd: 10,
	maxLeverage: 20,
	maintenanceMarginFraction: 0.025,
});
const input = (): OpenInput => ({
	config: { ...config },
	long: row("hl"),
	short: row("lighter-mainnet"),
	sizeUsd: 1000,
	maxSpreadBps: 50,
});
function reads(
	options: {
		credentials?: Record<string, unknown>;
		rebind?: boolean;
		rebindStatus?: number;
		requests?: string[];
		task?: unknown;
		missingTask?: boolean;
		metadata?: MarketMetadata;
		metadataError?: boolean;
		mark?: number;
	} = {},
) {
	const credentials = {
		...readyCredentials(owner, now),
		...options.credentials,
	};
	const client = new MobiusClient({
		version: "0.1.0",
		limit: async () => {},
		fetch: async (url) => {
			const u = new URL(url);
			options.requests?.push(u.pathname);
			if (u.pathname.endsWith("/task"))
				return options.missingTask
					? Response.json({ error: "Task not found" }, { status: 404 })
					: Response.json(options.task ?? publicTask);
			if (u.pathname.endsWith("rebind-check"))
				return Response.json(
					options.rebind === false
						? { error: "Active task uses venue" }
						: { allowed: true },
					{
						status:
							options.rebindStatus ?? (options.rebind === false ? 409 : 200),
					},
				);
			const venue = u.pathname.includes("/lighter/")
				? (u.searchParams.get("venue") as keyof typeof credentials)
				: u.pathname.includes("/aster/")
					? "aster"
					: "hl";
			return Response.json(credentials[venue]);
		},
	});
	const metadata = async (venue: string) => {
		if (options.metadataError) throw new Error("metadata HTTP 503");
		return options.metadata ?? meta(venue);
	};
	return {
		read: client.read.bind(client),
		metadata,
		client,
		market: async (venue: string) => ({
			row: { ...row(venue), markPrice: options.mark ?? 100_000 },
			metadata: await metadata(venue),
		}),
	};
}

test("open preflight records every named rule and rechecks the read plan", async () => {
	const result = await openPreflight(
		{ ...input(), protect: 8, assumedLeverage: [5, 5] },
		reads(),
		() => now,
	);
	expect(result.ok).toBe(true);
	expect(result.quantizedBase).toEqual({ long: 0.01, short: 0.01 });
	expect(result.checks.map((c) => c.name)).toEqual([
		"config.owner",
		"config.signer",
		"config.policy",
		"readiness.hl",
		"readiness.lighter-mainnet",
		"open-interest",
		"marks",
		"metadata.long",
		"metadata.short",
		"size",
		"entry-spread",
		"protection",
	]);
	expect(result.checks.at(-1)?.detail).toContain(
		"assumed leverage, not verified on the venue",
	);
	const p = { preflightPlan: { checks: result.plan } } as Proposal;
	expect((await runPreflight(p, reads().client, () => now)).ok).toBe(true);
	const expired = readyCredentials(owner, now)["lighter-mainnet"];
	expired.integratorApprovalExpiresAt = now + 86_400_000;
	expect(
		(
			await runPreflight(
				p,
				reads({ credentials: { "lighter-mainnet": expired } }).client,
				() => now,
			)
		).ok,
	).toBe(false);
});
test.each([
	[
		"config.owner",
		(p: OpenInput) => {
			delete p.config.owner;
		},
	],
	[
		"config.signer",
		(p: OpenInput) => {
			delete p.config.signer;
		},
	],
	[
		"config.signer",
		(p: OpenInput) => {
			p.config.signer = "walletconnect";
		},
	],
	[
		"config.policy",
		(p: OpenInput) => {
			p.config.policy = "locked";
		},
	],
	[
		"open-interest",
		(p: OpenInput) => {
			p.long.oiCapped = true;
		},
	],
	[
		"open-interest",
		(p: OpenInput) => {
			delete p.long.oiCapped;
		},
	],
	[
		"marks",
		(p: OpenInput) => {
			delete p.long.markPrice;
		},
	],
	[
		"marks",
		(p: OpenInput) => {
			p.short.markPrice = 0;
		},
	],
	[
		"size",
		(p: OpenInput) => {
			p.sizeUsd = 1;
		},
	],
	[
		"size",
		(p: OpenInput) => {
			p.sizeUsd = Number.NaN;
		},
	],
	[
		"entry-spread",
		(p: OpenInput) => {
			p.short.markPrice = 102000;
		},
	],
	[
		"entry-spread",
		(p: OpenInput) => {
			p.maxSpreadBps = -1;
		},
	],
	[
		"protection",
		(p: OpenInput) => {
			p.protect = 8;
		},
	],
	[
		"protection",
		(p: OpenInput) => {
			p.protect = 101;
			p.assumedLeverage = [2, 2];
		},
	],
	[
		"protection",
		(p: OpenInput) => {
			p.protect = 8;
			p.assumedLeverage = [20, 20];
		},
	],
	[
		"protection",
		(p: OpenInput) => {
			p.protect = 8;
			p.assumedLeverage = [21, 2];
		},
	],
] as const)("open first failure is %s", async (name, change) => {
	const p = input();
	change(p);
	const result = await openPreflight(p, reads(), () => now);
	expect(result.ok).toBe(false);
	expect(result.checks.at(-1)).toMatchObject({ name, ok: false });
	expect(result.checks.at(-1)?.error).toBeTruthy();
});
test.each(["hl", "aster", "lighter", "lighter-mainnet"] as const)(
	"%s readiness passes even when rebind is blocked, and fails when unbound",
	async (venue) => {
		const p = input();
		p.long = row(venue);
		p.short = row(venue === "hl" ? "lighter" : "hl");
		expect((await openPreflight(p, reads(), () => now)).ok).toBe(true);
		const unbound = await openPreflight(
			p,
			reads({ credentials: { [venue]: { bound: false } } }),
			() => now,
		);
		expect(unbound.checks.at(-1)?.error).toContain("not_bound");
		const requests: string[] = [];
		const blocked = reads({ rebind: false, requests });
		const result = await openPreflight(p, blocked, () => now);
		expect(result.ok).toBe(true);
		expect(
			(
				await runPreflight(
					{ preflightPlan: { checks: result.plan } } as Proposal,
					blocked.client,
					() => now,
				)
			).ok,
		).toBe(true);
		expect(requests.some((route) => route.endsWith("rebind-check"))).toBe(
			false,
		);
	},
);
test.each(["hl", "aster"] as const)(
	"%s key-invalid and builder failures use server issue enum",
	async (venue) => {
		const p = input();
		p.long = row(venue);
		for (const [credential, issue] of [
			[{ bound: false, issue: "key_invalid" }, "key_invalid"],
			[
				{ bound: true, agentAddress: owner, builderApproved: false },
				"builder_fee_missing",
			],
			[
				{ bound: false, repair: { agentAddress: owner } },
				"builder_fee_missing",
			],
		] as const) {
			const result = await openPreflight(
				p,
				reads({ credentials: { [venue]: credential } }),
				() => now,
			);
			expect(result.checks.at(-1)?.error).toContain(issue);
		}
	},
);
test.each([undefined, now + 86_400_000, now + 86_400_001, Number.NaN])(
	"mainnet integrator expiry boundary %s",
	async (expiry) => {
		const c = {
			...readyCredentials(owner, now)["lighter-mainnet"],
			integratorApprovalExpiresAt: expiry,
		};
		const result = await openPreflight(
			input(),
			reads({ credentials: { "lighter-mainnet": c } }),
			() => now,
		);
		expect(result.ok).toBe(expiry === now + 86_400_001);
	},
);
test("mainnet approval is required even with sufficient remaining time", async () => {
	const c = {
		...readyCredentials(owner, now)["lighter-mainnet"],
		integratorApproved: false,
	};
	expect(
		(
			await openPreflight(
				input(),
				reads({ credentials: { "lighter-mainnet": c } }),
				() => now,
			)
		).checks.at(-1)?.error,
	).toContain("integrator_approval_missing");
});
test("metadata failure, each floor and unknown maintenance margin fail explicitly", async () => {
	expect(
		(
			await openPreflight(input(), reads({ metadataError: true }), () => now)
		).checks.at(-1)?.name,
	).toBe("metadata.long");
	for (const metadata of [
		{ ...meta("hl"), minBase: 0.02 },
		{ ...meta("hl"), minNotionalUsd: 1001 },
	])
		expect(
			(await openPreflight(input(), reads({ metadata }), () => now)).checks.at(
				-1,
			)?.name,
		).toBe("size");
	const metadata = meta("hl");
	delete metadata.maintenanceMarginFraction;
	expect(
		(
			await openPreflight(
				{ ...input(), protect: 8, assumedLeverage: [2, 2] },
				reads({ metadata }),
				() => now,
			)
		).checks.at(-1)?.error,
	).toContain("maintenance margin unavailable");
});
test("coarser lot applies to both legs; spread equality is accepted", async () => {
	const r = reads();
	r.metadata = async (venue) => ({
		...meta(venue),
		sizeDecimals: venue === "hl" ? 2 : 3,
		lotSize: venue === "hl" ? 0.01 : 0.001,
	});
	const p = input();
	p.sizeUsd = 1234.5;
	p.short.markPrice = 100100;
	p.maxSpreadBps = (100 / 100050) * 10000;
	const result = await openPreflight(p, r, () => now);
	expect(result.ok).toBe(true);
	expect(result.quantizedBase).toEqual({ long: 0.01, short: 0.01 });
	expect(quantizeLot(0.012, { sizeDecimals: 3, lotSize: 0.005 })).toBe(0.01);
	expect(quantizeLot(0.012, { sizeDecimals: 3, lotSize: 0.005 }, true)).toBe(
		0.015,
	);
});
test("status separates credential readiness from rebind permission", async () => {
	const result = await bindingReadiness(
		owner,
		reads({
			credentials: { aster: { bound: false, issue: "key_invalid" } },
			rebind: false,
		}),
		() => now,
	);
	expect(result.find((r) => r.venue === "aster")).toMatchObject({
		ready: false,
		error: "aster: key_invalid",
	});
	expect(result.filter((r) => r.ready)).toHaveLength(3);
	expect(result.every((r) => r.rebindAllowed === false)).toBe(true);
});

test.each([
	"close",
	"neutralize",
	"resize",
	"protect",
	"auto-close",
	"size-mismatch-close",
] as const)("%s task checks pass and fail", async (command) => {
	const targets = command === "resize" ? { long: 0.06 } : {};
	expect(
		(
			await managePreflight(
				command,
				"1842",
				config,
				targets,
				reads(),
				() => now,
			)
		).ok,
	).toBe(true);
	for (const [options, name] of [
		[{ missingTask: true }, "task.exists"],
		[{ task: { ...publicTask, owner: `0x${"2".repeat(40)}` } }, "task.owner"],
		[{ task: { ...publicTask, status: "closed" } }, "task.status"],
	] as const) {
		const result = await managePreflight(
			command,
			"1842",
			config,
			targets,
			reads(options),
			() => now,
		);
		expect(result.ok).toBe(false);
		expect(result.checks.at(-1)?.name).toBe(name);
	}
});
test("close accepts non-terminal states; other commands require running", async () => {
	const r = reads({ task: { ...publicTask, status: "trimming" } });
	expect(
		(await managePreflight("close", "1842", config, {}, r, () => now)).ok,
	).toBe(true);
	expect(
		(await managePreflight("protect", "1842", config, {}, r, () => now)).ok,
	).toBe(false);
});
test("resize rounds toward current and rejects no-op, tiny order and uncloseable stub", async () => {
	const r = reads();
	const increase = await managePreflight(
		"resize",
		"1842",
		config,
		{ long: 0.06789 },
		r,
		() => now,
	);
	expect(increase.quantized).toEqual({ longTargetBase: 0.067 });
	const reduce = await managePreflight(
		"resize",
		"1842",
		config,
		{ short: 0.01234 },
		r,
		() => now,
	);
	expect(reduce.quantized).toEqual({ shortTargetBase: 0.013 });
	for (const targets of [{}, { long: 0.05 }, { long: 0.05001 }, { long: 0 }])
		expect(
			(await managePreflight("resize", "1842", config, targets, r, () => now))
				.ok,
		).toBe(false);
	const largeFloor = reads({ metadata: { ...meta("hl"), minBase: 0.01 } });
	expect(
		(
			await managePreflight(
				"resize",
				"1842",
				config,
				{ long: 0.049 },
				largeFloor,
				() => now,
			)
		).ok,
	).toBe(false);
	expect(
		(
			await managePreflight(
				"resize",
				"1842",
				config,
				{ long: 0.001 },
				largeFloor,
				() => now,
			)
		).ok,
	).toBe(false);
});

test("status reports unavailable rebind checks without changing credential readiness", async () => {
	const result = await bindingReadiness(
		owner,
		reads({ rebindStatus: 503 }),
		() => now,
	);
	expect(
		result.every(
			(r) =>
				r.ready && r.rebindAllowed === null && r.rebindError?.includes("503"),
		),
	).toBe(true);
	const allowed = await bindingReadiness(owner, reads(), () => now);
	expect(allowed.every((r) => r.ready && r.rebindAllowed === true)).toBe(true);
});
