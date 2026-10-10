import {
	type WalletConnectFactory,
	walletConnectInitOptions,
} from "./walletconnect-client.ts";

export const createSdkClient: WalletConnectFactory = async (
	projectId,
	signal,
) => {
	signal.throwIfAborted();
	const { SignClient } = await import("@walletconnect/sign-client");
	signal.throwIfAborted();
	const sdk = await SignClient.init(walletConnectInitOptions(projectId));
	let closing: Promise<void> | undefined;
	async function close() {
		if (closing) return closing;
		closing = (async () => {
			const reason = {
				code: 6000,
				message: "mstack Proposal interaction ended",
			};
			const disconnects = [
				...sdk.session
					.getAll()
					.map((session) => sdk.disconnect({ topic: session.topic, reason })),
				...sdk.core.pairing
					.getPairings()
					.map((pairing) =>
						sdk.core.pairing.disconnect({ topic: pairing.topic }),
					),
			];
			// Network cleanup cannot extend a Proposal's signing deadline.
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				await Promise.race([
					Promise.allSettled(disconnects),
					new Promise<void>((resolve) => {
						timer = setTimeout(resolve, 500);
					}),
				]);
			} finally {
				if (timer) clearTimeout(timer);
				sdk.core.heartbeat.stop();
				await sdk.core.relayer.transportClose();
				signal.removeEventListener("abort", abort);
			}
		})();
		return closing;
	}
	const abort = () => {
		void close().catch(() => {});
	};
	signal.addEventListener("abort", abort, { once: true });
	if (signal.aborted) {
		await close();
		signal.throwIfAborted();
	}
	return {
		connect: (params) => sdk.connect(params),
		request: (params) => sdk.request(params),
		session: { get: (topic) => sdk.session.get(topic) },
		on: (event, listener) => {
			sdk.on(event, listener);
		},
		off: (event, listener) => {
			sdk.off(event, listener);
		},
		close,
	};
};
