# Third-party notices

cairn is Apache-2.0 (`LICENSE`). Its shipped artifacts — the npm tarball's
`bin/cairn.mjs`, the release binaries, the playground bundles — additionally
*contain* third-party code, so this notice travels with them.

Build-only tools (esbuild, Bun, biome, typescript) are not listed: nothing of
theirs is distributed.

## elkjs

Version 0.12.0, inlined unmodified. Upstream: https://github.com/kieler/elkjs

Declared license: `EPL-2.0 OR GPL-3.0-or-later`. cairn elects **EPL-2.0** — full
text at https://www.eclipse.org/legal/epl-2.0/ and in `LICENSE.md` inside the
elkjs package.

Per EPL-2.0 §3.1(a): the source code for elkjs is available under the EPL-2.0,
and can be obtained from https://github.com/kieler/elkjs or from the published
package at https://registry.npmjs.org/elkjs/-/elkjs-0.12.0.tgz — the exact
version is pinned in `package-lock.json`, which each artifact's build provenance
ties it back to.

cairn asserts no ownership over elkjs and does not relicense it. Apache-2.0
covers cairn's own code only.

---

If the set of inlined dependencies changes, update this file in the same commit.
`files` in `package.json` ships it with the npm package; it lives in the repo for
every other channel.
