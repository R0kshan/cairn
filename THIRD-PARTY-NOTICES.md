# Third-party notices

cairn is Apache-2.0 (`LICENSE`). Its shipped artifacts — the npm tarball's
`bin/cairn.mjs`, the release binaries, the playground bundles — additionally
*contain* third-party code, so this notice travels with them.

Build-only tools (esbuild, biome, typescript) are not listed: nothing of theirs
is distributed. Bun is a different case — `bun build --compile` embeds its
runtime in every release binary — and has its own section below.

Where each artifact carries this notice:

| Artifact | How the notices travel |
|---|---|
| npm tarball | `files` ships `LICENSE`, this file and `licenses/`; both bundles also carry a `/*!` banner naming what they inline |
| release binaries | `cairn licenses` prints the notice from inside the binary; the texts also ship as a `cairn-<version>-licenses.tar.gz` release asset, unpacked into `share/doc/cairn` by `packaging/install.sh`, into the formula's `doc` by the Homebrew tap, and into the app directory by the Scoop manifest |
| playground | `LICENSE`, this file and `licenses/` are served from the deployed site beside the bundle and linked from the page header; the bundle carries the same banner |

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

## Bun

The release binaries are built with `bun build --compile`
(`scripts/build-binaries.sh`), which packages cairn's code **together with the
Bun runtime** into one executable. So unlike esbuild, biome and typescript, Bun
is not merely a build tool here: part of it is distributed in every binary
cairn publishes. The npm bundles and the playground are built with esbuild and
carry none of it, and `cairn licenses` says so per artifact — the binaries
print the Bun paragraph, the npm CLI does not.

**Version 1.4.0.** The release workflow pins `bun-version`
(`.github/workflows/release.yml`) rather than tracking `latest`, because a
notice that cannot name the runtime it shipped is not a notice. The same pin is
recorded in `src/notice.ts` as `BUN_VERSION`.

Bun itself is MIT. Its runtime statically links a long list of further
components with their own terms. Bun's own `LICENSE.md` is the authoritative
enumeration of them, and it is reproduced verbatim at
[`licenses/bun-LICENSE.md`](./licenses/bun-LICENSE.md) — fetched from the
`bun-v1.4.0` tag, so it enumerates the runtime cairn actually embeds rather
than whatever upstream `main` says today. That file, not this section, is the
notice for everything Bun links; it is shipped with every binary.

### JavaScriptCore and LGPL-2.1

The component that carries real obligations is JavaScriptCore, from WebKit,
which Bun links statically and which is LGPL-2.1 for part of its source. The
full text is at [`licenses/LGPL-2.1.txt`](./licenses/LGPL-2.1.txt). tinycc,
also in Bun's list, is LGPL-2.1 as well.

LGPL-2.1 §6 permits distributing a work that statically links the library
provided the recipient can modify the library and relink. cairn discharges that
as follows, and everything named here is published:

- **The library's source.** JavaScriptCore as Bun links it is at
  <https://github.com/oven-sh/webkit>, at the revision Bun pins in
  `WEBKIT_VERSION`. Bun's `LICENSE.md` gives the relink procedure verbatim.
- **cairn's own source, which is the rest of the work.** Apache-2.0, at
  <https://github.com/R0kshan/cairn>, at the tag the binary was built from —
  `cairn version` prints that tag, and the release carries a build-provenance
  attestation tying the binary to that commit.
- **The build that combines them.** `scripts/build-binaries.sh`, in the same
  repository, is the whole of it: one `bun build --compile` invocation against
  a pinned Bun. Anyone who relinks a modified JavaScriptCore into Bun by
  upstream's procedure can rerun that script and obtain an equivalent cairn
  binary.

Requests for anything in this list that you cannot obtain from those URLs
should be opened as an issue on the cairn repository.

> **This is a good-faith implementation, not a legal opinion.** Static linking
> of LGPL-2.1 code is an area where reasonable lawyers differ, particularly on
> whether an offer of source-plus-build-script is equivalent to the "object
> format" §6 speaks of. The facts above are accurate and the materials are
> genuinely published; whether they are sufficient for a given jurisdiction or
> distribution is a question for counsel. If you need certainty without that
> question, the npm and playground artifacts contain no Bun and no LGPL code at
> all.

## simple-icons

Version 16.29.0, CC0-1.0. Upstream: https://github.com/simple-icons/simple-icons

cairn's shipped artifacts and runtime do not depend on simple-icons; only
regenerating the logos does. A curated
subset of its icon *paths* — the ones behind `logo: <name>` — is vendored into
`src/logos.ts` by `scripts/update-logos.mjs`, which fetches the pinned version
with `npm pack` and writes the paths out as source. The full license text is in
[`licenses/simple-icons-CC0-1.0.md`](./licenses/simple-icons-CC0-1.0.md), a
verbatim copy of the project's own `LICENSE.md` at that version.

That version stamp is deliberate. The file records which licence governed the
paths cairn actually ships, so it is a historical fact rather than a mirror of
upstream: a later relicence there cannot make it wrong, and cannot oblige a
cairn release. CC0 is irrevocable, so paths vendored under it stay CC0 whatever
simple-icons does next.

**The project licence is not the whole story.** Simple Icons' `DISCLAIMER.md`
says individual icons may carry their own terms, and some of the ones cairn
vendors do. `scripts/update-logos.mjs` reads each icon's declared licence and
refuses anything cairn cannot pass on under its own Apache-2.0 — so such an icon
cannot reach `src/logos.ts` even if someone adds it to the curated list. The
reasons differ by licence, and are set out with the table below.

<!-- generated by scripts/update-logos.mjs — do not edit by hand -->

Most of the 37 vendored icons carry no licence of their own and are
covered by the project-wide CC0-1.0 above. These declare their own, which
applies to that icon's artwork instead:

| Icon | Licence | Full text | Artwork source |
| --- | --- | --- | --- |
| Angular (`angular`) | CC-BY-4.0 | [`CC-BY-4.0.txt`](./licenses/CC-BY-4.0.txt) | <https://angular.dev/press-kit> |
| Apache (`apache`) | Apache-2.0 | [`Apache-2.0.txt`](./licenses/Apache-2.0.txt) | <https://www.apache.org/foundation/press/kit> |
| Apache Kafka (`apachekafka`) | Apache-2.0 | [`Apache-2.0.txt`](./licenses/Apache-2.0.txt) | <https://apache.org/logos> |
| Apache Spark (`apachespark`) | Apache-2.0 | [`Apache-2.0.txt`](./licenses/Apache-2.0.txt) | <https://apache.org/logos> |
| JavaScript (`javascript`) | MIT | [`MIT-javascript-logo.js.txt`](./licenses/MIT-javascript-logo.js.txt) | <https://github.com/voodootikigod/logo.js/blob/1544bdeed6d618a6cfe4f0650d04ab8d9cfa76d9/js.svg> |
| OpenJDK (`openjdk`) | BSD-3-Clause | [`BSD-3-Clause.txt`](./licenses/BSD-3-Clause.txt) | <https://hg.openjdk.java.net/duke/duke/file/ca00f100dafc/vector/Agent.svg> |

Each permits commercial redistribution and asks for attribution, which this
table and the shipped licence texts are. **Attribution is to the artwork
source named above.** Where a rights-holder publishes no copyright line at
that source — as is the case for several of these marks — cairn identifies
the origin by that URL rather than assert a copyright holder it cannot
verify. `licenses/BSD-3-Clause.txt` is consequently the SPDX template, with
the `<year> <owner>` fields as upstream left them; see `licenses/README.md`.

Three kinds of terms are refused by the generator instead, and never reach
`src/logos.ts`, for three different reasons:

- **NonCommercial** bars the commercial use cairn's own Apache-2.0 grants
  downstream, so cairn would be promising a right it does not hold.
- **ShareAlike** does permit commercial use, but requires adaptations to carry
  the same licence — an obligation cairn cannot discharge on behalf of whoever
  embeds the mark in their own diagram.
- **A trademark policy** in place of a licence is not a copyright grant at all,
  so there is no permission to copy the artwork to rely on.

<!-- end generated -->

CC0-1.0 waives copyright and imposes no attribution requirement, so for the
icons it covers this entry is a courtesy rather than an obligation. It is kept
because the paths reach users inside every shipped artifact, and a reader
deserves to know where the artwork came from. For the icons in the table above
it is not a courtesy: MIT, BSD-3-Clause, CC-BY-4.0 and Apache-2.0 each require
the attribution it carries.

**Trademarks are a separate matter from the license.** Simple Icons' own
`DISCLAIMER.md` is explicit that CC0 covers the project while individual icons
may carry their own terms, and that brand marks remain the property of their
owners. cairn redistributes the artwork only; it claims no rights in the brands
depicted, and using a logo in a diagram does not imply the brand endorses
anything. Anyone republishing a cairn diagram is responsible for their own use
of the marks it shows.

---

If the set of inlined dependencies changes, update this file **and** `licenses/`
**and** `src/notice.ts` in the same commit — a notice that names a license text
the tarball doesn't carry is the failure mode this section exists to prevent.
`files` in `package.json` ships them with the npm package.

`src/notice.ts` is the single source for the short form: the bundle banners
(`scripts/notice-banner.sh`) and `cairn licenses` both render from it, so they
cannot drift apart. `tests/notice.test.ts` fails the build if a checked-in
artifact's banner no longer matches. The long form — full texts, per-icon
attribution, the LGPL relink offer — is this file, and `licenses/README.md`
records where each text was fetched from.
