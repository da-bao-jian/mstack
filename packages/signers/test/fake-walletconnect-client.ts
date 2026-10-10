import {
	type Hex,
	hexToString,
	type PrivateKeyAccount,
	type TypedDataDefinition,
} from "viem";
import type {
	WalletConnectClient,
	WalletConnectEvent,
	WalletConnectFactory,
	WalletConnectSession,
} from "../src/walletconnect-client.ts";

export function fakeWalletConnect(wallet: PrivateKeyAccount, chain = 1) {
	const session: WalletConnectSession = {
		topic: "fixture-session",
		expiry: Math.floor(Date.now() / 1000) + 600,
		namespaces: {
			eip155: {
				accounts: [`eip155:${chain}:${wallet.address}`],
				methods: ["personal_sign", "eth_signTypedData_v4"],
				events: ["accountsChanged", "chainChanged"],
			},
		},
	};
	const calls = {
		projectIds: [] as string[],
		signals: [] as AbortSignal[],
		connects: [] as Parameters<WalletConnectClient["connect"]>[0][],
		requests: [] as Parameters<WalletConnectClient["request"]>[0][],
		closes: 0,
	};
	const listeners = new Map<string, Set<(event: { topic: string }) => void>>();
	const client: WalletConnectClient = {
		async connect(params) {
			calls.connects.push(params);
			return {
				uri: `wc:${"a".repeat(64)}@2?relay-protocol=irn&symKey=${"b".repeat(64)}`,
				approval: async () => session,
			};
		},
		async request(params) {
			calls.requests.push(params);
			const [first, second] = params.request.params;
			if (params.request.method === "personal_sign")
				return wallet.signMessage({ message: hexToString(first as Hex) });
			if (params.request.method === "eth_signTypedData_v4")
				return wallet.signTypedData(JSON.parse(second) as TypedDataDefinition);
			throw new Error(`Unexpected method ${params.request.method}`);
		},
		session: {
			get: (topic) => {
				if (topic !== session.topic) throw new Error("Unknown topic");
				return session;
			},
		},
		on: (event, listener) => {
			if (!listeners.has(event)) listeners.set(event, new Set());
			listeners.get(event)?.add(listener);
		},
		off: (event, listener) => {
			listeners.get(event)?.delete(listener);
		},
		async close() {
			calls.closes++;
		},
	};
	const factory: WalletConnectFactory = async (projectId, signal) => {
		calls.projectIds.push(projectId);
		calls.signals.push(signal);
		return client;
	};
	return {
		client,
		factory,
		calls,
		session,
		emit: (event: WalletConnectEvent) => {
			for (const listener of listeners.get(event) ?? [])
				listener({ topic: session.topic });
		},
	};
}
