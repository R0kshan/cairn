/**
 * The third-party notice every cairn artifact carries, and the single source it
 * is carried from.
 *
 * Three channels have to state the same facts, and they used to state them in
 * three places:
 *
 *   - the JavaScript bundles, through the `/*!` banner esbuild prepends
 *     (`scripts/notice-banner.sh` renders this text into that form);
 *   - the compiled binaries, through `cairn version --licenses`, since a single-file
 *     executable has nowhere else to put a notice a user can actually read;
 *   - `THIRD-PARTY-NOTICES.md`, which carries the long form — the full licence
 *     texts, the per-icon attribution table, the LGPL relink offer.
 *
 * Duplicated prose drifts, and a notice that drifts is a notice that is wrong
 * for at least one artifact. So the short form lives here, in the one file all
 * three read from, and `tests/notice.test.ts` asserts the rendered banner and
 * the checked-in bundles still match it.
 *
 * Versions are pinned deliberately: a notice that says "bundles elkjs" without
 * saying which elkjs does not let a reader check what they were given. Keep
 * them in step with `package-lock.json`, `scripts/update-logos.mjs` and the
 * `bun-version` pinned in `.github/workflows/`.
 */

/** elkjs release inlined into every bundle and binary. Matches package-lock.json. */
export const ELKJS_VERSION = "0.12.0";

/** simple-icons release the vendored paths in `src/logos.ts` came from. */
export const SIMPLE_ICONS_VERSION = "16.29.0";

/**
 * Bun release the published binaries are compiled with, and therefore the one
 * whose runtime they embed. Pinned in the release workflow; a floating `latest`
 * would leave this notice unable to say what it actually shipped.
 */
export const BUN_VERSION = "1.4.0";

const NOTICES_URL = "https://github.com/R0kshan/cairn/blob/main/THIRD-PARTY-NOTICES.md";

/**
 * What every artifact contains. The binaries additionally embed the Bun runtime
 * — see `BUN_NOTICE` — which the esbuild-built bundles do not.
 */
const COMMON = `cairn — Apache-2.0 — https://github.com/R0kshan/cairn
Copyright 2026 Røkshan.

This artifact contains third-party code and artwork:

elkjs ${ELKJS_VERSION} — (c) 2017 Kiel University and others.
  Dual-licensed EPL-2.0 OR GPL-3.0-or-later; cairn elects EPL-2.0.
  Full text: licenses/elkjs-EPL-2.0.md — https://www.eclipse.org/legal/epl-2.0

Simple Icons ${SIMPLE_ICONS_VERSION} artwork — CC0-1.0 project-wide.
  Six of the vendored icons carry their own terms instead — MIT,
  BSD-3-Clause, CC-BY-4.0 or Apache-2.0 — and are attributed individually.
  Full texts: licenses/`;

/**
 * Only true of the compiled binaries. `bun build --compile` packages cairn
 * together with the Bun runtime, so a binary redistributes JavaScriptCore's
 * LGPL-2.1 portions and everything else Bun statically links; the npm bundles
 * and the playground are built with esbuild and carry none of it.
 */
const BUN_NOTICE = `

Bun ${BUN_VERSION} runtime — MIT — embedded by \`bun build --compile\`.
  It statically links JavaScriptCore/WebKit, which is LGPL-2.1 in part,
  alongside BSD- and Apache-licensed components. Bun's own LICENSE.md
  enumerates all of them verbatim: licenses/bun-LICENSE.md
  Relinking under LGPL-2.1 §6: see THIRD-PARTY-NOTICES.md.`;

/**
 * Deliberately does not say the texts sit *beside* the binary: only npm and
 * Scoop put them there. The curl installer and Homebrew put them under
 * share/doc/cairn, so an adjacency claim would send two of the four channels'
 * users looking in the wrong directory. Naming the channels costs three lines
 * and is true for all of them.
 */
const FOOTER = `
Per-icon attribution and the full licence texts ship with this artifact:
  the package root (npm), the app directory (Scoop), or
  share/doc/cairn (Homebrew, install.sh). Also at
  ${NOTICES_URL}`;

/**
 * Injected as `true` by `scripts/build-binaries.sh` only. Under node — the npm
 * CLI, `node src/cli.ts` — no bundler ever defined it, so `typeof` (safe on an
 * undeclared identifier, same trick as CAIRN_BUILD_VERSION in cli.ts) falls
 * through to `false` and the Bun paragraph is correctly omitted.
 */
declare const CAIRN_EMBEDS_BUN: boolean | undefined;

/** True when running from a `bun build --compile` binary that embeds the runtime. */
export const embedsBun = (): boolean =>
  typeof CAIRN_EMBEDS_BUN !== "undefined" && CAIRN_EMBEDS_BUN;

/**
 * The notice as plain text, tailored to what this artifact actually contains.
 * `cairn version --licenses` prints this; the banner renders the `embedsBun:false`
 * form, since no esbuild bundle carries Bun.
 */
export function notice({ bun = embedsBun() }: { bun?: boolean } = {}): string {
  return COMMON + (bun ? BUN_NOTICE : "") + "\n" + FOOTER;
}
