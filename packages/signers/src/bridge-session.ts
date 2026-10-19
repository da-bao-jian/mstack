import { randomBytes, timingSafeEqual } from "node:crypto";

const secret = /^[a-f0-9]{64}$/;
const equal = (supplied: string, expected: string) =>
	secret.test(supplied) &&
	timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));

/**
 * The printed signing link works once: the first page load trades its token
 * for an HttpOnly session cookie, so a copy of the link left in a terminal or
 * an agent's transcript cannot drive the bridge afterwards. A reload of the
 * opened tab keeps working through the cookie.
 */
export function bridgeSession() {
	const token = randomBytes(32).toString("hex");
	const session = randomBytes(32).toString("hex");
	let opened = false;
	let name = "mob_session";
	const cookie = (req: Request) => {
		for (const part of (req.headers.get("cookie") ?? "").split(";")) {
			const [key, value = ""] = part.trim().split("=");
			if (key === name) return value;
		}
		return "";
	};
	return {
		token,
		/** Cookies ignore ports, so each bridge names its own. */
		bind(port: number) {
			name = `mob_${port}`;
		},
		/** A page load: the session cookie, or the unused link token, which is spent. */
		page(req: Request, url: URL): { ok: boolean; setCookie?: string } {
			if (equal(cookie(req), session)) return { ok: true };
			if (!opened && equal(url.searchParams.get("t") ?? "", token)) {
				opened = true;
				return {
					ok: true,
					setCookie: `${name}=${session}; HttpOnly; SameSite=Strict; Path=/`,
				};
			}
			return { ok: false };
		},
		/** An API call from the opened page. */
		api(req: Request): boolean {
			return equal(cookie(req), session);
		},
	};
}
