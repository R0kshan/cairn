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
| release binaries | the texts ship as a `cairn-<version>-licenses.tar.gz` release asset, unpacked into `share/doc/cairn` by `packaging/install.sh`, into the formula's `doc` by the Homebrew tap, and into the app directory by the Scoop manifest — that is what carries the licences. `install.sh` is fail-closed in its own code: it verifies the bundle against the release checksums and installs nothing at all, binary included, if it cannot. Homebrew and Scoop are given the same checksums by `scripts/render-packaging.mjs` and abort on a mismatch through their own resource verification rather than through anything cairn does. `cairn version --licenses` additionally prints the short notice from inside the binary, so a copy separated from its directory still says what it contains |
| playground | `LICENSE`, this file and `licenses/` are served from the deployed site beside the bundle and linked from the page header; the bundle carries the same banner |

## What this means for you

The rest of this file records what cairn owes and to whom. This section is the
other direction: what, if anything, *you* take on. It is a plain reading of the
licence texts in `licenses/`, not legal advice, and the summary below is not a
substitute for the terms themselves.

Three situations, in increasing order of what they ask of you.

### You generate diagrams with cairn

Nothing. Using a tool is not redistributing it, and every obligation in this
file attaches to distributing copies. cairn claims nothing in the diagrams you
produce.

One thing worth knowing, because it is the only case where a third party's
terms reach your output: **a rendered SVG embeds the icon artwork it draws.**
31 of the 37 built-in logos are CC0-1.0, which waives copyright and asks for
nothing. Six carry their own terms and ask for attribution:

| Logo | Licence |
|---|---|
| `angular` | CC-BY-4.0 |
| `apache`, `apachekafka`, `apachespark` | Apache-2.0 |
| `javascript` | MIT |
| `openjdk` | BSD-3-Clause |

A diagram that uses none of those six carries no third-party artwork with
conditions attached, and cairn writes nothing extra into it. One that does is a
redistribution of that artwork, so the SVG carries its own attribution: an XML
comment after the opening `<svg>` tag naming each licensed mark it drew, the
artwork's source, the rights-holder's copyright line where one is published,
and a URL for the licence text. Only the marks actually painted are named.

**Keep that comment in the file.** It is the attribution those four licences
ask for, and an exported SVG travels without the `licenses/` directory that
discharges this everywhere else. An optimiser set to strip comments — `svgo`
does by default — removes the only notice the diagram carries. The per-icon
table further down this file says the same thing at more length, for anyone
who has the repository rather than a lone SVG.

One limit worth stating: Apache-2.0 §4(a) asks that recipients be given "a copy
of the License", and a comment of that size in every diagram is not practical,
so the SVG links the text rather than embedding it. CC-BY-4.0 §3(a)(3) permits
a link outright; MIT and BSD-3-Clause get the holder's copyright line inline
where one exists. If you need a diagram to carry the texts themselves, ship
`licenses/` beside it.

Separately from copyright: the brands these logos depict are their owners'
trademarks. Drawing one in a diagram is not an endorsement, and cairn grants no
rights in the marks themselves.

### You use cairn as an npm package

Two quite different cases, and which one you are in depends on how your own
thing is distributed.

**cairn as a dependency.** Your package declares `@r0kshan/cairn` in
`dependencies` and your users' `npm install` fetches it from the registry, with
`LICENSE`, this file and `licenses/` intact in `node_modules`. You are
distributing no copies of cairn, so nothing here attaches to you. Just don't
strip those files out of what you publish.

**cairn bundled into your artifact** — a webpack/rollup/esbuild bundle, a
Docker image, an Electron app, a single-file CLI. Now cairn's code, and the
elkjs inside it, are part of what you hand someone. You take on cairn's
Apache-2.0 (`LICENSE`), elkjs' EPL-2.0 (§3.2(b) wants a copy of the Agreement
with each copy of the program), and the per-icon attribution. In practice that
is copying `LICENSE`, this file and `licenses/` out of the installed package
into your own distribution.

`bin/cairn.mjs` and `dist/cairn.mjs` each begin with a `/*!` banner naming what
they contain, and most minifiers preserve `/*!` by default. **Check your
bundler's comment settings**: one configured to strip all comments removes the
only notice the code itself carries.

Note that the icon artwork is in the bundle whether or not you ever use a
`logo:` — the table is not tree-shaken. So for redistribution the six licensed
icons above apply regardless; it is only your *output* that depends on which
logos you actually draw.

**EPL-2.0 does not reach your code.** Its copyleft covers modifications to the
EPL'd work; cairn does not modify elkjs, and bundling is not modification. Your
own code stays under whatever licence you choose. This is why cairn elects
EPL-2.0 from elkjs' dual offer rather than GPL-3.0-or-later.

### You redistribute cairn itself

Republishing the binaries, mirroring the release assets, or shipping a cairn
executable inside something else. This is the heavy case, and it is what most
of this file exists for: the binaries additionally embed the Bun runtime, which
statically links JavaScriptCore under the LGPL in part, along with everything
else in `licenses/bun-LICENSE.md`.

The short version is that the licence texts have to travel with the binary.
Every installer cairn publishes already puts them on disk for you, but not next
to the executable: the curl installer unpacks them into `share/doc/cairn`
beside the `bin/` it installs into, Homebrew stages them into the formula's
`doc` directory, and Scoop unpacks them into the app directory. Copying just
the binary out of an install therefore leaves the notices behind — take those
files with it. If you are building your own, read the Bun and JavaScriptCore
sections below before you ship.

## elkjs

Version 0.12.0, inlined unmodified. Upstream: https://github.com/kieler/elkjs

Declared license: `EPL-2.0 OR GPL-3.0-or-later`. cairn elects **EPL-2.0** — full
text in [`licenses/elkjs-EPL-2.0.md`](./licenses/elkjs-EPL-2.0.md), a verbatim
copy of elkjs' own `LICENSE.md`, upstream at https://www.eclipse.org/legal/epl-2.0/.

That copy is vendored rather than referenced because elkjs is a *devDependency*:
the published package installs zero dependencies, so `node_modules/elkjs/` never
reaches a consumer while the inlined code does. The inlined form is source
code, so EPL-2.0 §3.2(b) requires a copy of the Agreement with each copy of it,
and `files` ships that copy in the tarball.

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
carry none of it, and `cairn version --licenses` says so per artifact — the binaries
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

### JavaScriptCore and the LGPL

The component that carries real obligations is JavaScriptCore, from WebKit,
which Bun links statically and which is under the GNU Lesser (originally
Library) General Public License for part of its source. Which version takes a
sentence to state, because the sources disagree in wording rather than in
substance: Bun's `LICENSE.md` labels it `LGPL-2`, while WebKit's own file
headers offer "version 2 of the License, or (at your option) any later
version". cairn takes that offer at **2.1** — that is the text shipped at
[`licenses/LGPL-2.1.txt`](./licenses/LGPL-2.1.txt), and the §6 offer below is
written against it. tinycc, also in Bun's list, is LGPL v2.1 outright.

LGPL-2.1 §6 permits distributing a work that statically links the library
provided the recipient can modify the library and relink. cairn discharges that
as follows, and everything named here is published:

- **The library's source.** JavaScriptCore as Bun links it is at
  <https://github.com/oven-sh/webkit>, at revision
  `0f966e81b78c84bb23213e391bc679c4ef83e56b` — the `WEBKIT_VERSION` pinned in
  `scripts/build/deps/webkit.ts` at Bun's `bun-v1.4.0` tag, which is the Bun
  the release workflow is pinned to. Naming the revision rather than the
  repository is the point: "the version Bun happens to use" is not something a
  recipient can check, and a relink has to start from the same source the
  binary was built against. Bun's `LICENSE.md` gives the relink procedure
  verbatim, and it is reproduced at `licenses/bun-LICENSE.md`.
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
| OpenJDK (`openjdk`) | BSD-3-Clause | [`BSD-3-Clause.txt`](./licenses/BSD-3-Clause.txt) | <https://github.com/openjdk/duke/blob/master/vector/Agent.svg> |

Each permits commercial redistribution and asks for attribution, which this
table and the shipped licence texts are. **Attribution is to the artwork
source named above.** Where a rights-holder publishes no copyright line at
that source — as is the case for several of these marks — cairn identifies
the origin by that URL rather than assert a copyright holder it cannot
verify. `licenses/BSD-3-Clause.txt` is consequently the SPDX template, with
the `<year> <owner>` fields as upstream left them; see `licenses/README.md`.

Source notes:

- **OpenJDK (`openjdk`)** — simple-icons records <https://hg.openjdk.java.net/duke/duke/file/ca00f100dafc/vector/Agent.svg>, and that Mercurial host has been retired — it answers 403. The attribution above therefore names the live GitHub location of the same file, recorded in SOURCE_OVERRIDES rather than silently swapped. Checked 2026-09-04: that repository has no LICENSE file, the GitHub API reports no licence for it, and `vector/Agent.svg` carries no copyright notice of its own. So there is no upstream copyright line to reproduce, which is why `licenses/BSD-3-Clause.txt` keeps the SPDX `<year> <owner>` fields blank and attribution for this mark is to the source URL.

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
(`scripts/notice-banner.sh`) and `cairn version --licenses` both render from it,
so they cannot drift apart. `tests/notice.test.ts` fails the build if a checked-in
artifact's banner no longer matches. The long form — full texts, per-icon
attribution, the LGPL relink offer — is this file, and `licenses/README.md`
records where each text was fetched from.
