# Third-party notices

cairn is Apache-2.0 (`LICENSE`). Its shipped artifacts — the npm tarball's
`bin/cairn.mjs`, the release binaries, the playground bundles — additionally
*contain* third-party code, so this notice travels with them.

Build-only tools (esbuild, Bun, biome, typescript) are not listed: nothing of
theirs is distributed.

## elkjs

Version 0.12.0, inlined unmodified. Upstream: https://github.com/kieler/elkjs

Declared license: `EPL-2.0 OR GPL-3.0-or-later`. cairn elects **EPL-2.0** — full
text in [`licenses/elkjs-EPL-2.0.md`](./licenses/elkjs-EPL-2.0.md), a verbatim
copy of elkjs' own `LICENSE.md`, upstream at https://www.eclipse.org/legal/epl-2.0/.

That copy is vendored rather than referenced because elkjs is a *devDependency*:
the published package installs zero dependencies, so `node_modules/elkjs/` never
reaches a consumer while the inlined code does. EPL-2.0 §3.1(b) requires the
license to travel with the distributed form, so `files` ships it in the tarball.

Per EPL-2.0 §3.1(a): the source code for elkjs is available under the EPL-2.0,
and can be obtained from https://github.com/kieler/elkjs or from the published
package at https://registry.npmjs.org/elkjs/-/elkjs-0.12.0.tgz — the exact
version is pinned in `package-lock.json`, which each artifact's build provenance
ties it back to.

cairn asserts no ownership over elkjs and does not relicense it. Apache-2.0
covers cairn's own code only.

---

If the set of inlined dependencies changes, update this file **and** `licenses/`
in the same commit — a notice that names a license text the tarball doesn't carry
is the failure mode this section exists to prevent. `files` in `package.json`
ships both with the npm package.
