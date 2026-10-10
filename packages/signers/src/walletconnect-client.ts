export interface WalletConnectSession {
	topic: string;
	expiry: number;
	namespaces: Record<
		string,
		{ accounts: string[]; methods: string[]; events?: string[] }
	>;
}
export type WalletConnectEvent =
	| "session_update"
	| "session_event"
	| "session_delete"
	| "session_expire";
type Listener = (event: { topic: string }) => void;
export interface WalletConnectClient {
	connect(params: {
		requiredNamespaces: Record<
			string,
			{ chains: string[]; methods: string[]; events: string[] }
		>;
	}): Promise<{ uri?: string; approval: () => Promise<WalletConnectSession> }>;
	request(params: {
		topic: string;
		chainId: string;
		request: { method: string; params: string[] };
	}): Promise<unknown>;
	session: { get(topic: string): WalletConnectSession };
	on(event: WalletConnectEvent, listener: Listener): void;
	off(event: WalletConnectEvent, listener: Listener): void;
	close(): Promise<void>;
}
export type WalletConnectFactory = (
	projectId: string,
	signal: AbortSignal,
) => Promise<WalletConnectClient>;

/** Protocol keys and pairing state live only for this one-shot interaction. */
export function walletConnectInitOptions(projectId: string) {
	const data = new Map<string, unknown>();
	return {
		projectId,
		telemetryEnabled: false,
		logger: "silent" as const,
		customStoragePrefix: `mstack-${crypto.randomUUID()}`,
		metadata: {
			name: "mstack",
			description: "Approve one stored mstack Proposal",
			url: "https://github.com/da-bao-jian/mstack",
			icons: [] as string[],
		},
		storage: {
			async getKeys() {
				return [...data.keys()];
			},
			async getEntries<T>() {
				return [...data.entries()] as [string, T][];
			},
			async getItem<T>(key: string) {
				return data.get(key) as T | undefined;
			},
			async setItem<T>(key: string, value: T) {
				data.set(key, value);
			},
			async removeItem(key: string) {
				data.delete(key);
			},
		},
	};
}

/** Worker isolation also disposes SDK request timers, which transportClose does not. */
export const createWalletConnectClient: WalletConnectFactory = (
	projectId,
	signal,
) => {
	signal.throwIfAborted();
	return createWorkerClient(
		new Worker(
			new URL(
				import.meta.path.endsWith(".ts")
					? "./walletconnect-worker.ts"
					: "./walletconnect-worker.js",
				import.meta.url,
			).href,
		),
		projectId,
		signal,
	);
};

export type WorkerCommand =
	| { id: number; method: "init"; params: { projectId: string } }
	| {
			id: number;
			method: "connect";
			params: Parameters<WalletConnectClient["connect"]>[0];
	  }
	| { id: number; method: "approval" }
	| { id: number; method: "close" }
	| {
			id: number;
			method: "request";
			params: Parameters<WalletConnectClient["request"]>[0];
	  };
export type WorkerAnswer =
	| {
			id: number;
			result?: unknown;
			error?: string;
			session?: WalletConnectSession;
	  }
	| { event: WalletConnectEvent; topic: string };
type WithoutId<T> = T extends WorkerCommand ? Omit<T, "id"> : never;

/** Exported for offline lifecycle tests with a scripted worker; never retries RPC. */
export async function createWorkerClient(
	worker: Worker,
	projectId: string,
	signal: AbortSignal,
): Promise<WalletConnectClient> {
	let sequence = 0;
	let ended = false;
	let closing: Promise<void> | undefined;
	const pending = new Map<
		number,
		{ resolve(value: unknown): void; reject(error: Error): void }
	>();
	const sessions = new Map<string, WalletConnectSession>();
	const listeners = new Map<WalletConnectEvent, Set<Listener>>();
	function rpc<T>(command: WithoutId<WorkerCommand>): Promise<T> {
		if (ended || (closing && command.method !== "close"))
			return Promise.reject(new Error("WalletConnect client closed"));
		const id = ++sequence;
		return new Promise<T>((resolve, reject) => {
			pending.set(id, { resolve: (value) => resolve(value as T), reject });
			worker.postMessage({ ...command, id });
		});
	}
	function terminate(error: Error) {
		if (ended) return;
		ended = true;
		worker.terminate();
		for (const call of pending.values()) call.reject(error);
		pending.clear();
		sessions.clear();
		listeners.clear();
		signal.removeEventListener("abort", abort);
	}
	async function close() {
		if (closing) return closing;
		if (ended) return;
		closing = (async () => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				await Promise.race([
					rpc({ method: "close" }),
					new Promise<void>((resolve) => {
						timer = setTimeout(resolve, 1000);
					}),
				]);
			} finally {
				if (timer) clearTimeout(timer);
				terminate(new Error("WalletConnect client closed"));
			}
		})();
		return closing;
	}
	const abort = () => {
		void close().catch(() => {});
	};
	worker.onmessage = ({ data }: MessageEvent<WorkerAnswer>) => {
		if (ended) return;
		if ("event" in data) {
			for (const listener of listeners.get(data.event) ?? [])
				listener({ topic: data.topic });
			return;
		}
		if (data.session) sessions.set(data.session.topic, data.session);
		const call = pending.get(data.id);
		if (!call) return;
		pending.delete(data.id);
		if (data.error) call.reject(new Error(data.error));
		else call.resolve(data.result);
	};
	worker.onerror = (event) => {
		event.preventDefault();
		terminate(new Error(`WalletConnect worker failed: ${event.message}`));
	};
	signal.addEventListener("abort", abort, { once: true });
	try {
		signal.throwIfAborted();
		await rpc({ method: "init", params: { projectId } });
		signal.throwIfAborted();
	} catch (error) {
		await close().catch(() => {});
		throw error;
	}
	return {
		async connect(params) {
			const result = await rpc<{ uri?: string }>({ method: "connect", params });
			return {
				...result,
				approval: () => rpc<WalletConnectSession>({ method: "approval" }),
			};
		},
		request: (params) => rpc({ method: "request", params }),
		session: {
			get(topic) {
				const session = sessions.get(topic);
				if (!session) throw new Error("Unknown WalletConnect session");
				return session;
			},
		},
		on(event, listener) {
			if (!listeners.has(event)) listeners.set(event, new Set());
			listeners.get(event)?.add(listener);
		},
		off(event, listener) {
			listeners.get(event)?.delete(listener);
		},
		close,
	};
}
