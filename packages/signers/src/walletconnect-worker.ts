import type {
	WalletConnectClient,
	WalletConnectSession,
	WorkerAnswer,
	WorkerCommand,
} from "./walletconnect-client.ts";
import { createSdkClient } from "./walletconnect-sdk.ts";

const abort = new AbortController();
let client: WalletConnectClient | undefined;
let approval: (() => Promise<WalletConnectSession>) | undefined;
const reply = (answer: WorkerAnswer) => self.postMessage(answer);

self.onmessage = async ({ data }: MessageEvent<WorkerCommand>) => {
	try {
		if (data.method === "close") {
			abort.abort(new Error("WalletConnect interaction ended"));
			await client?.close();
			reply({ id: data.id });
			return;
		}
		abort.signal.throwIfAborted();
		if (data.method === "init") {
			if (client) throw new Error("WalletConnect already initialized");
			client = await createSdkClient(data.params.projectId, abort.signal);
			for (const event of [
				"session_update",
				"session_event",
				"session_delete",
				"session_expire",
			] as const)
				client.on(event, ({ topic }) => reply({ event, topic }));
			reply({ id: data.id });
			return;
		}
		if (!client) throw new Error("WalletConnect is not initialized");
		if (data.method === "connect") {
			const pairing = await client.connect(data.params);
			approval = pairing.approval;
			reply({ id: data.id, result: { uri: pairing.uri } });
		} else if (data.method === "approval") {
			if (!approval) throw new Error("WalletConnect pairing not started");
			const session = await approval();
			reply({
				id: data.id,
				result: session,
				session: client.session.get(session.topic),
			});
		} else {
			const result = await client.request(data.params);
			reply({
				id: data.id,
				result,
				session: client.session.get(data.params.topic),
			});
		}
	} catch (error) {
		reply({
			id: data.id,
			error: error instanceof Error ? error.message : String(error),
		});
	}
};
