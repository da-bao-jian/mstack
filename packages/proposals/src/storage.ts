import { constants } from "node:fs";
import { mkdir, open, rename, rmdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";
export async function readPrivate(path: string): Promise<string> {
	const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const info = await file.stat();
		if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 1_048_576)
			throw new Error("State must be a private 0600 file under 1 MiB");
		return await file.readFile("utf8");
	} finally {
		await file.close();
	}
}
export async function exclusive(path: string, text: string): Promise<void> {
	const file = await open(path, "wx", 0o600);
	try {
		await file.writeFile(text);
		await file.sync();
	} finally {
		await file.close();
	}
	const dir = await open(dirname(path), "r");
	try {
		await dir.sync();
	} finally {
		await dir.close();
	}
}
export async function atomic(path: string, text: string): Promise<void> {
	const temporary = `${path}.${crypto.randomUUID()}.tmp`;
	await exclusive(temporary, text);
	try {
		await rename(temporary, path);
	} catch (error) {
		await unlink(temporary);
		throw error;
	}
	const dir = await open(dirname(path), "r");
	try {
		await dir.sync();
	} finally {
		await dir.close();
	}
}
export async function locked<T>(
	path: string,
	fn: () => Promise<T>,
): Promise<T> {
	try {
		await mkdir(path, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST")
			throw new Error(
				"Proposal state is busy or an interrupted operation needs review",
			);
		throw error;
	}
	try {
		return await fn();
	} finally {
		await rmdir(path);
	}
}
