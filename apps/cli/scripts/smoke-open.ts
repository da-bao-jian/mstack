import { openFlow } from "../test/fixtures/open-flow.ts";

// Offline only. The fixture uses recorded HL/Lighter reads and a disposable
// keystore with an injected TTY reader. No key or passphrase enters argv/env.
await openFlow(console.log);
