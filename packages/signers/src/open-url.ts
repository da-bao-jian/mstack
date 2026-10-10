import { spawn } from "node:child_process";

/** No shell interpolation. The bridge supplies a fixed loopback URL with a hex token. */
export async function openUrl(url: string): Promise<void> {
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
