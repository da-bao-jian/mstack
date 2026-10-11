import type { FetchContext } from "../src/types.ts";
import { fixtureContext } from "./fixtures.ts";

/** HL meta is a projection of a recorded metaAndAssetCtxs response. Aster exchangeInfo is recorded and trimmed. */
export async function metadataContext(
	overrides: Record<string, unknown> = {},
): Promise<FetchContext> {
	const { ctx } = await fixtureContext(overrides);
	return {
		...ctx,
		fetch: async (url, init) => {
			let file: string | undefined;
			let project = false;
			if (url === "https://api.hyperliquid.xyz/info" && init?.body) {
				const query = JSON.parse(String(init.body));
				if (query.type === "meta") {
					file = `hyperliquid/${query.dex ?? "core"}-meta.json`;
					project = true;
				}
			}
			if (url === "https://fapi.asterdex.com/fapi/v3/exchangeInfo")
				file = "aster/exchangeInfo.json";
			if (!file) return ctx.fetch(url, init);
			const value = Object.hasOwn(overrides, file)
				? overrides[file]
				: await Bun.file(
						new URL(`../fixtures/${file}`, import.meta.url),
					).json();
			return Response.json(project ? value[0] : value);
		},
	};
}
