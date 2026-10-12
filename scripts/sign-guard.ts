import { signGuard } from "../apps/cli/src/sign-guard.ts";

process.exit(await signGuard(await Bun.stdin.text(), console.error));
