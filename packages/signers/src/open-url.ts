import { spawn } from "node:child_process";

/**
 * True when no browser may be opened: `MOB_NO_OPEN` is set to anything but
 * "0" or "", or the process runs under a test runner (`NODE_ENV=test`, which
 * `bun test` sets). The caller always prints the URL, so a suppressed open is
 * never silent.
 */
export function openSuppressed(env: NodeJS.ProcessEnv = process.env): boolean {
	const flag = env.MOB_NO_OPEN ?? "";
	if (flag !== "" && flag !== "0") return true;
	return env.NODE_ENV === "test";
}

/** No shell interpolation. The bridge supplies a fixed loopback URL with a hex token. */
export async function openUrl(url: string): Promise<void> {
	if (openSuppressed()) return;
	const [command, ...args] =
		process.platform === "darwin"
			? ["open", url]
			: process.platform === "win32"
				? ["cmd", "/c", "start", "", url]
				: ["xdg-open", url];
	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, { stdio: "ignore" });
		child.once("error", reject);
		child.once("exit", (code) =>
			code === 0
				? resolve()
				: reject(new Error(`Browser opener exited ${code}`)),
		);
	});
}
