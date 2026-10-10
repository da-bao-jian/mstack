// Bun 1.3.8 discovers only one test root. Keep reference/ outside it while
// including the CLI suite in both `bun test` and `bun test packages apps`.
import "../apps/cli/test/cli.test.ts";
import "../apps/cli/test/history-view.test.ts";
import "../apps/cli/test/upgrade.test.ts";
import "../apps/cli/test/mcp.test.ts";
import "../apps/cli/test/proposals.test.ts";
