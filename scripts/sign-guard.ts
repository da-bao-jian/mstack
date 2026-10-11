import { signGuard } from "../apps/cli/src/sign-guard.ts";

process.exit(signGuard(await Bun.stdin.text(), console.error));
