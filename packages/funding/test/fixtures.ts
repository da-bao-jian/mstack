import manifest from "../fixtures/manifest.json";
import type {
	FetchContext,
	ObservedFundingRate,
	VenueFailure,
} from "../src/types.ts";
import expectedRows from "./expected.json";

export const expected = expectedRows as Record<string, ObservedFundingRate[]>;

export const observedAt = 1_791_635_200_000;

async function fixture(file: string): Promise<unknown> {
	return Bun.file(new URL(`../fixtures/${file}`, import.meta.url)).json();
}

export async function changed(
	file: string,
	path: readonly (string | number)[],
	value: unknown,
): Promise<unknown> {
	const body = await fixture(file);
	let target = body as Record<string | number, unknown>;
	for (const key of path.slice(0, -1))
		target = target[key] as Record<string | number, unknown>;
	target[path[path.length - 1]] = value;
	return body;
}

export async function fixtureContext(overrides: Record<string, unknown> = {}) {
	const bodies = new Map(
		await Promise.all(
			manifest.map(
				async (record) =>
					[
						record.file,
						Object.hasOwn(overrides, record.file)
							? overrides[record.file]
							: await fixture(record.file),
					] as const,
			),
		),
	);
	const failures: VenueFailure[] = [];
	const calls: { url: string; init?: RequestInit }[] = [];
	const ctx: FetchContext = {
		now: () => observedAt,
		signal: new AbortController().signal,
		reportFailure: (failure) => {
			failures.push(failure);
		},
		fetch: async (url, init) => {
			calls.push({ url, init });
			const record = manifest.find(
				(record) =>
					record.url === url &&
					record.method === (init?.method ?? "GET") &&
					JSON.stringify("body" in record ? record.body : undefined) ===
						init?.body,
			);
			if (!record)
				throw new Error(`Unrecorded request: ${url} ${init?.body ?? ""}`);
			const body = bodies.get(record.file);
			if (body instanceof Response) return body.clone();
			return Response.json(body);
		},
	};
	return { ctx, calls, failures };
}
