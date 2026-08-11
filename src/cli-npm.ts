/**
 * Entry point for the CLI bundle published to npm (`scripts/build-cli.sh` →
 * `bin/cairn.mjs`). Not used when running from a checkout, and not imported by
 * anything else.
 *
 * It exists because the package must ship plain JavaScript: Node refuses to
 * strip types for any file under `node_modules`, so the launcher approach in
 * `bin/cairn.js` — re-exec node on `src/cli.ts` — cannot work once installed.
 *
 * Two reasons this is a separate file rather than bundling `src/cli.ts` directly:
 *
 *  1. `elk-engine.ts`'s fallback loads the worker through a deliberately
 *     non-literal `import("./elk-worker" + ".ts")`, which esbuild resolves
 *     before it constant-folds and so leaves external — fine for the browser
 *     bundle (that's what keeps the worker out of it), fatal for a CLI bundle.
 *     Injecting the factory here means the fallback is never reached; the
 *     unresolved import survives in the output as dead code.
 *  2. `cli.ts` dispatches at module scope, and a static import would hoist
 *     above `setElkFactory`. Hence the dynamic import below.
 */

import { setElkFactory } from "./elk-engine.ts";
import { nodeElkFactory } from "./elk-worker.ts";

setElkFactory(nodeElkFactory);

await import("./cli.ts");
