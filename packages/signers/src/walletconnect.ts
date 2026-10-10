import { type Address, getAddress, stringToHex } from "viem";
import {
	assertPayload,
	checkedView,
	deferred,
	type InteractiveSigner,
	pinnedChain,
	type SigningView,
	verifySignature,
} from "./interactive.ts";
import {
	createWalletConnectClient,
	type WalletConnectClient,
	type WalletConnectFactory,
} from "./walletconnect-client.ts";

export interface WalletConnectOptions {
	projectId: string;
	onPairing: (uri: string) => void;
	createClient?: WalletConnectFactory;
	now?: () => number;
}

/** A fresh session for one immutable Proposal. Never retries a signing request. */
export function walletConnectSigner(
	input: SigningView,
	options: WalletConnectOptions,
): InteractiveSigner {
	const view = checkedView(input);
	if (!/^[a-f0-9]{32}$/i.test(options.projectId))
		throw new Error(
			"Set walletconnect_project_id to your Reown project ID before using walletconnect",
		);
	const now = options.now ?? Date.now;
	// EIP-191 has no chain. Use Ethereum's namespace for unpinned requests.
	const chain = pinnedChain(view) ?? 1;
	const chainId = `eip155:${chain}`;
	const method =
		view.signing.type === "text" ? "personal_sign" : "eth_signTypedData_v4";
	const abort = new AbortController();
	const ended = deferred<never>();
	let terminal: Error | undefined;
	let client: WalletConnectClient | undefined;
	let topic: string | undefined;
	let connection: Promise<Address> | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let requested = false;
	let cleanup = Promise.resolve();
	const changed = (event: { topic: string }) => {
		if (event.topic === topic)
			end(
				new Error(
					"WalletConnect session changed or disconnected; stage a new Proposal",
				),
			);
	};
	function end(error: Error) {
		if (terminal) return;
		terminal = error;
		if (timer) clearTimeout(timer);
		abort.abort(error);
		ended.reject(error);
		if (client) {
			for (const event of [
				"session_update",
				"session_event",
				"session_delete",
				"session_expire",
			] as const)
				client.off(event, changed);
			cleanup = client.close();
			void cleanup.catch(() => {});
		}
	}
	function alive() {
		if (now() >= view.expiresAt)
			end(new Error("Proposal expired while waiting for WalletConnect wallet"));
		if (terminal) throw terminal;
	}
	async function wait<T>(pending: Promise<T>): Promise<T> {
		const result = await Promise.race([pending, ended.promise]);
		alive();
		return result;
	}
	function account(): Address {
		if (!client || !topic)
			throw new Error("WalletConnect session is not connected");
		const session = client.session.get(topic);
		if (!Number.isSafeInteger(session.expiry) || session.expiry * 1000 <= now())
			throw new Error("WalletConnect session expired");
		const namespace = session.namespaces.eip155 ?? session.namespaces[chainId];
		if (
			!namespace ||
			!Array.isArray(namespace.accounts) ||
			!namespace.accounts.length ||
			!namespace.methods.includes(method)
		)
			throw new Error(
				"WalletConnect session does not authorize the requested method",
			);
		let hasChain = false;
		for (const item of namespace.accounts) {
			const match = /^eip155:([1-9]\d*):(0x[\da-fA-F]{40})$/.exec(item);
			if (!match || getAddress(match[2]) !== getAddress(view.owner))
				throw new Error(
					"WalletConnect session account does not match Proposal owner",
				);
			if (Number(match[1]) === chain) hasChain = true;
		}
		if (!hasChain)
			throw new Error(
				"WalletConnect session does not authorize the Proposal chain",
			);
		return getAddress(view.owner);
	}
	function connect(): Promise<Address> {
		alive();
		if (connection) return connection;
		timer = setTimeout(
			() =>
				end(
					new Error("Proposal expired while waiting for WalletConnect wallet"),
				),
			Math.max(0, view.expiresAt - now()),
		);
		connection = (async () => {
			const creating = (options.createClient ?? createWalletConnectClient)(
				options.projectId,
				abort.signal,
			);
			// A late SDK initialization must not revive an expired interaction.
			void creating
				.then(async (created) => {
					if (terminal) await created.close();
				})
				.catch(() => {});
			client = await wait(creating);
			for (const event of [
				"session_update",
				"session_event",
				"session_delete",
				"session_expire",
			] as const)
				client.on(event, changed);
			const pairing = await wait(
				client.connect({
					requiredNamespaces: {
						eip155: {
							chains: [chainId],
							methods: [method],
							events: ["accountsChanged", "chainChanged"],
						},
					},
				}),
			);
			if (!pairing.uri || !/^wc:[a-f0-9]+@2\?/.test(pairing.uri))
				throw new Error("WalletConnect did not return a v2 pairing URI");
			const approval = pairing.approval();
			void approval.catch(() => {});
			options.onPairing(pairing.uri);
			const session = await wait(approval);
			topic = session.topic;
			if (!topic) throw new Error("WalletConnect returned an invalid session");
			return account();
		})().catch((error) => {
			end(error instanceof Error ? error : new Error(String(error)));
			throw error;
		});
		return connection;
	}
	async function sign(payload: SigningView["signing"]) {
		alive();
		assertPayload(view, payload);
		if (requested) throw new Error("Proposal signing already requested");
		requested = true;
		try {
			await connect();
			const address = account();
			if (!client || !topic)
				throw new Error("WalletConnect session is not connected");
			alive();
			const params =
				view.signing.type === "text"
					? [stringToHex(view.signing.message), address]
					: [address, JSON.stringify(view.signing.typedData)];
			const signature = await wait(
				client.request({ topic, chainId, request: { method, params } }),
			);
			const accepted = await wait(verifySignature(view, account(), signature));
			end(new Error("WalletConnect signing completed"));
			return accepted;
		} catch (error) {
			end(error instanceof Error ? error : new Error(String(error)));
			throw error;
		}
	}
	return {
		address: async () => connect(),
		async chainId() {
			await connect();
			account();
			return chain;
		},
		signMessage: ({ message }) =>
			typeof message === "string"
				? sign({ type: "text", message })
				: Promise.reject(
						new Error("WalletConnect Proposal requires a UTF-8 text message"),
					),
		signTypedData: (typedData) => sign({ type: "typed", typedData }),
		async close() {
			end(new Error("WalletConnect signing cancelled"));
			await cleanup;
		},
	};
}
