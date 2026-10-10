/** Shared by client instances, keyed by host (including port). No burst or retries. */
export function createRateLimiter(
	now = Date.now,
	sleep = (ms: number) =>
		new Promise<void>((resolve) => setTimeout(resolve, ms)),
) {
	const hosts = new Map<string, { tail: Promise<void>; next: number }>();
	return async (host: string, signal?: AbortSignal) => {
		let state = hosts.get(host);
		if (!state) {
			state = { tail: Promise.resolve(), next: 0 };
			hosts.set(host, state);
		}
		const slot = state;
		const pending = slot.tail.then(async () => {
			signal?.throwIfAborted();
			const delay = slot.next - now();
			if (delay > 0) await sleep(delay);
			signal?.throwIfAborted();
			slot.next = now() + 500;
		});
		slot.tail = pending.catch(() => {});
		await pending;
	};
}
export const limitHost = createRateLimiter();
