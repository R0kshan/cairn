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

## simple-icons

Version 16.29.0, CC0-1.0. Upstream: https://github.com/simple-icons/simple-icons

cairn's shipped artifacts and runtime do not depend on simple-icons; only
regenerating the logos does. A curated
subset of its icon *paths* — the ones behind `logo: <name>` — is vendored into
`src/logos.ts` by `scripts/update-logos.mjs`, which fetches the pinned version
with `npm pack` and writes the paths out as source. The full license text is in
[`licenses/simple-icons-CC0-1.0.md`](./licenses/simple-icons-CC0-1.0.md), a
verbatim copy of the project's own `LICENSE.md`.

CC0-1.0 waives copyright and imposes no attribution requirement, so this entry
is a courtesy rather than an obligation. It is kept because the paths reach
users inside every shipped artifact, and a reader deserves to know where the
artwork came from.

**Trademarks are a separate matter from the license.** Simple Icons' own
`DISCLAIMER.md` is explicit that CC0 covers the project while individual icons
may carry their own terms, and that brand marks remain the property of their
owners. cairn redistributes the artwork only; it claims no rights in the brands
depicted, and using a logo in a diagram does not imply the brand endorses
anything. Anyone republishing a cairn diagram is responsible for their own use
of the marks it shows.

---

If the set of inlined dependencies changes, update this file **and** `licenses/`
in the same commit — a notice that names a license text the tarball doesn't carry
is the failure mode this section exists to prevent. `files` in `package.json`
ships both with the npm package.
