import { createHash } from "node:crypto";
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readlink,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const defaultBase = "https://github.com/da-bao-jian/mstack/releases/download";

export async function installLatestRelease(
	options: {
		home?: string;
		baseUrl?: string;
		platform?: string;
		arch?: string;
	} = {},
): Promise<string> {
	const home = options.home ?? homedir();
	const os = options.platform ?? process.platform;
	const arch = options.arch ?? process.arch;
	if (
		!["darwin", "linux", "win32"].includes(os) ||
		!["arm64", "x64"].includes(arch) ||
		(os === "win32" && arch !== "x64")
	)
		throw new Error(`No mob release for ${os}-${arch}; build with Bun.`);
	const asset = `mob-${os === "win32" ? "windows" : os}-${arch}${os === "win32" ? ".exe" : ""}`;
	const base = (
		(options.baseUrl ?? process.env.MSTACK_RELEASE_BASE_URL) ||
		defaultBase
	).replace(/\/$/, "");
	const get = async (url: string) => {
		const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
		if (!response.ok)
			throw new Error(
				`Release download failed: HTTP ${response.status} (${url})`,
			);
		return response;
	};
	const version = (
		await (
			await get(`${base.replace(/\/download$/, "")}/latest/download/VERSION`)
		).text()
	).trim();
	if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
		throw new Error("Invalid release version");
	const sums = await (await get(`${base}/v${version}/SHA256SUMS`)).text();
	const matches = sums
		.split(/\r?\n/)
		.map((line) => /^(\S+)\s+\*?(\S+)$/.exec(line))
		.filter((match) => match?.[2] === asset);
	if (matches.length !== 1 || !/^[a-f\d]{64}$/i.test(matches[0]?.[1] ?? ""))
		throw new Error(`Missing, invalid or duplicate checksum for ${asset}`);
	const binary = await (
		await get(`${base}/v${version}/${asset}`)
	).arrayBuffer();
	const digest = createHash("sha256")
		.update(new Uint8Array(binary))
		.digest("hex");
	if (digest !== matches[0]?.[1].toLowerCase())
		throw new Error(`SHA-256 mismatch for ${asset}; nothing installed`);

	const cache = join(home, ".mob/bin");
	const target = join(cache, `mob-${version}`);
	const localBin = join(home, ".local/bin");
	const link = join(localBin, "mob");
	// Refuse to replace an unrelated local command.
	try {
		const info = await lstat(link);
		if (
			!info.isSymbolicLink() ||
			dirname(resolve(localBin, await readlink(link))) !== cache
		)
			throw new Error(
				`Refusing to replace ${link}; it is not a mob cache link`,
			);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	await mkdir(cache, { recursive: true, mode: 0o700 });
	await chmod(cache, 0o700);
	const staging = await mkdtemp(join(cache, ".download-"));
	try {
		const staged = join(staging, asset);
		await writeFile(staged, new Uint8Array(binary), { mode: 0o755 });
		await chmod(staged, 0o755);
		await rename(staged, target);
		await mkdir(localBin, { recursive: true });
		const stagedLink = join(localBin, `.mob-${crypto.randomUUID()}`);
		try {
			await symlink(target, stagedLink, "file");
			await rename(stagedLink, link);
		} finally {
			await rm(stagedLink, { force: true });
		}
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
	return `Downloaded mob ${version}, verified SHA-256, and installed ${target}. Updated ${link}.`;
}
