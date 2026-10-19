import { request } from "node:http";

/** Test-only HTTP transport; the global no-network fetch guard stays enabled. */
export async function loopback(
	url: string | URL,
	init: RequestInit = {},
): Promise<Response> {
	const target = new URL(url);
	if (target.protocol !== "http:" || target.hostname !== "127.0.0.1")
		throw new Error("Loopback only");
	return new Promise((resolve, reject) => {
		const req = request(
			target,
			{
				method: init.method,
				headers: Object.fromEntries(new Headers(init.headers)),
				signal: init.signal ?? undefined,
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
				res.on("error", reject);
				res.on("end", () => {
					const headers = new Headers();
					for (const [key, value] of Object.entries(res.headers))
						if (value !== undefined)
							headers.set(key, Array.isArray(value) ? value.join(", ") : value);
					resolve(
						new Response(Buffer.concat(chunks), {
							status: res.statusCode,
							headers,
						}),
					);
				});
			},
		);
		req.on("error", reject);
		req.end(init.body ? String(init.body) : undefined);
	});
}

/**
 * Opens a signing link like a browser tab: the page load trades the one-time
 * link token for the session cookie, which every later call carries.
 */
export async function openBridge(url: string | URL) {
	const target = new URL(url);
	const page = await loopback(target);
	const cookie = (page.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
	const api = (
		path: string,
		body?: unknown,
		overrides: { cookie?: string; origin?: string } = {},
	) =>
		loopback(`${target.origin}${path}`, {
			headers: {
				Cookie: overrides.cookie ?? cookie,
				...(body === undefined
					? {}
					: {
							"Content-Type": "application/json",
							Origin: overrides.origin ?? target.origin,
						}),
			},
			...(body === undefined
				? {}
				: { method: "POST", body: JSON.stringify(body) }),
		});
	return { page, cookie, api };
}
