import { constants } from "node:fs";
import {
	lstat,
	mkdir,
	open,
	rename,
	rm,
	rmdir,
	unlink,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
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
	log: (message: string) => void = console.error,
	action: "write" | "reject" = "write",
): Promise<T> {
	const id = basename(path).replace(/\.json\.lock$/, "");
	const busy = () =>
		new Error(
			id === "counter.lock"
				? "another mob process holds the Proposal counter; if it crashed, run again in a minute"
				: action === "reject"
					? `another mob process holds ${id}; if it crashed, wait a minute and run \`mob reject ${id}\` again`
					: `another mob process holds ${id}; if it crashed, run again in a minute or \`mob reject ${id}\``,
		);
	const ownerPath = join(path, "owner");
	const owner = JSON.stringify({
		pid: process.pid,
		started_at: Date.now(),
		token: crypto.randomUUID(),
	});
	for (let attempt = 0; ; attempt++) {
		try {
			await mkdir(path, { mode: 0o700 });
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			if (attempt > 2) throw busy();
		}
		try {
			const info = await lstat(path);
			let stale = false;
			try {
				const previous = JSON.parse(await readPrivate(ownerPath));
				if (
					!Number.isSafeInteger(previous.pid) ||
					previous.pid <= 0 ||
					!Number.isFinite(previous.started_at)
				)
					throw busy();
				stale = Date.now() - previous.started_at > 600_000;
				try {
					process.kill(previous.pid, 0);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ESRCH") stale = true;
					else if ((error as NodeJS.ErrnoException).code !== "EPERM")
						throw error;
				}
			} catch (error) {
				// Includes legacy empty locks and a crash between mkdir and owner write.
				stale =
					Date.now() - info.mtimeMs >
					((error as NodeJS.ErrnoException).code === "ENOENT"
						? 60_000
						: 600_000);
				if (!stale) throw busy();
			}
			if (!stale) throw busy();
			const current = await lstat(path);
			if (current.ino !== info.ino) continue;
			const retired = `${path}.${crypto.randomUUID()}.stale`;
			await rename(path, retired);
			await rm(retired, { recursive: true });
			log(`Reclaimed stale lock for ${id}.`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	await exclusive(ownerPath, owner);
	try {
		return await fn();
	} finally {
		await releaseLock(path, ownerPath, owner);
	}
}
async function releaseLock(path: string, ownerPath: string, owner: string) {
	try {
		// An old process must never release a replacement process's lock.
		if ((await readPrivate(ownerPath)) === owner) {
			await unlink(ownerPath);
			await rmdir(path);
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}
