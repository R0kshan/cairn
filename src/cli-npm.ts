/**
 * Entry point for the CLI bundle published to npm (`scripts/build-cli.sh` →
 * `bin/cairn.mjs`). Not used from a checkout, not imported by anything else.
 *
 * Exists because the package ships plain JavaScript: Node refuses to strip
 * types under `node_modules`, so `bin/cairn.js`'s re-exec-onto-`src/cli.ts`
 * approach cannot work once installed.
 *
 * A separate file rather than a bundle of `src/cli.ts`, for two reasons.
 * `elk-engine.ts`'s fallback loads the worker through a non-literal
 * `import("./elk-worker" + ".ts")` that esbuild leaves external — fine for the
 * browser bundle, fatal for a CLI one — so injecting the factory here leaves
 * that import as dead code. And `cli.ts` dispatches at module scope, so a static
 * import would hoist above `setElkFactory`; hence the dynamic import below.
 */

import { setElkFactory } from "./elk-engine.ts";
import { nodeElkFactory } from "./elk-worker.ts";

setElkFactory(nodeElkFactory);

await import("./cli.ts");
