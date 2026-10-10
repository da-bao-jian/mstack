import type { FetchContext } from "./types.ts";

export async function json(
	ctx: FetchContext,
	url: string,
	body?: object,
): Promise<unknown> {
	ctx.signal.throwIfAborted();
	const response = await ctx.fetch(url, {
		signal: ctx.signal,
		redirect: "error",
		...(body === undefined
			? {}
			: {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
				}),
	});
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	return response.json();
}
