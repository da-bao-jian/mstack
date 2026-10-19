import {
	chmod,
	link,
	lstat,
	mkdir,
	readFile,
	rename,
	unlink,
	writeFile,
} from "node:fs/promises";

async function status(path: string) {
	try {
		return await lstat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

/** Creates a 0700 directory, or checks an existing one: never a symlink. */
export async function privateDirectory(path: string): Promise<void> {
	const existing = await status(path);
	if (!existing) {
		await mkdir(path, { recursive: true, mode: 0o700 });
		await chmod(path, 0o700);
		return;
	}
	if (existing.isSymbolicLink())
		throw new Error(`${path}: symlink is not allowed`);
	if (!existing.isDirectory()) throw new Error(`${path}: expected a directory`);
	if ((existing.mode & 0o777) !== 0o700)
		throw new Error(`${path}: expected mode 0700`);
}

/** Reads a 0600 regular file; null when it does not exist. */
export async function readPrivate(path: string): Promise<string | null> {
	const file = await status(path);
	if (!file) return null;
	if (file.isSymbolicLink()) throw new Error(`${path}: symlink is not allowed`);
	if (!file.isFile()) throw new Error(`${path}: expected a regular file`);
	if ((file.mode & 0o777) !== 0o600)
		throw new Error(`${path}: expected mode 0600`);
	return readFile(path, "utf8");
}

/** A target may be absent or a 0600 regular file; never a symlink. */
export async function assertPrivateTarget(path: string): Promise<void> {
	const current = await status(path);
	if (current && (current.isSymbolicLink() || !current.isFile()))
		throw new Error(`${path}: symlink or non-file target is not allowed`);
	if (current && (current.mode & 0o777) !== 0o600)
		throw new Error(`${path}: expected mode 0600`);
}

async function temporaryPrivate(
	path: string,
	contents: string,
): Promise<string> {
	const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
	await writeFile(temporary, contents, { flag: "wx", mode: 0o600 });
	await chmod(temporary, 0o600);
	return temporary;
}

/** Writes a 0600 file beside the target; `commit` renames it into place and
 * `abort` removes it, so a caller can finish other work in between. */
export async function stagePrivate(
	path: string,
	contents: string,
): Promise<{ commit(): Promise<void>; abort(): Promise<void> }> {
	await assertPrivateTarget(path);
	const temporary = await temporaryPrivate(path, contents);
	const abort = () => unlink(temporary).catch(() => {});
	return {
		commit: async () => {
			try {
				await rename(temporary, path);
			} catch (error) {
				await abort();
				throw error;
			}
		},
		abort,
	};
}

export async function atomicPrivate(
	path: string,
	contents: string,
): Promise<void> {
	await (await stagePrivate(path, contents)).commit();
}

/** Creates a new 0600 file atomically and never replaces one: false when the
 * target already exists (another process won the race). */
export async function createPrivate(
	path: string,
	contents: string,
): Promise<boolean> {
	const temporary = await temporaryPrivate(path, contents);
	try {
		await link(temporary, path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
		throw error;
	} finally {
		await unlink(temporary).catch(() => {});
	}
}
