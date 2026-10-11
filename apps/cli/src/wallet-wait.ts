import { pairingQr } from "@mstack/signers";
import type { Runtime } from "./run.ts";

/** One URI per attempt; only a terminal gets an in-place countdown. */
export function walletWait(rt: Runtime, expiresAt: number) {
	let timer: ReturnType<typeof setInterval> | undefined;
	let printed = false;
	return {
		show(url: string, backend: "browser" | "walletconnect") {
			if (printed) return;
			printed = true;
			rt.out(url);
			if (!rt.stdoutIsTTY) return;
			if (backend === "walletconnect") rt.out(pairingQr(url));
			rt.out("If no page opened, paste the URL into your wallet browser");
			const update = () => {
				const seconds = Math.max(0, Math.ceil((expiresAt - rt.now()) / 1000));
				rt.writeStatus?.(
					`\r\x1b[2KWaiting for your wallet · expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
				);
			};
			update();
			timer = setInterval(update, 2000);
		},
		stop() {
			if (timer === undefined) return;
			clearInterval(timer);
			timer = undefined;
			rt.writeStatus?.("\r\x1b[2K");
		},
	};
}
