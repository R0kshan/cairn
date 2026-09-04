# Licence texts

Full texts of every third-party licence that reaches a cairn artifact. The
short notice is in each artifact itself (`cairn licenses`, or the banner at the
top of every bundle); the reasoning and the per-icon attribution are in
[`../THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md). This file records
where each text came from, so a reader can check it is verbatim.

Every file here is byte-for-byte upstream. Nothing in this directory is
edited — provenance notes live in this README precisely so the texts stay
unmodified.

| File | Applies to | Fetched from |
| --- | --- | --- |
| `elkjs-EPL-2.0.md` | elkjs 0.12.0, inlined into every bundle and binary | the Eclipse Public License 2.0 as published by the Eclipse Foundation |
| `simple-icons-CC0-1.0.md` | Simple Icons 16.29.0, the project-wide grant | simple-icons' own `LICENSE.md` at that version |
| `bun-LICENSE.md` | the Bun runtime embedded in the release binaries | `https://raw.githubusercontent.com/oven-sh/bun/bun-v1.4.0/LICENSE.md` |
| `LGPL-2.1.txt` | JavaScriptCore/WebKit and tinycc, statically linked by Bun | `https://www.gnu.org/licenses/old-licenses/lgpl-2.1.txt` |
| `MIT-javascript-logo.js.txt` | the `javascript` icon's artwork | `https://github.com/voodootikigod/logo.js` at rev `1544bdee`, which is the source simple-icons records |
| `BSD-3-Clause.txt` | the `openjdk` icon's artwork | the SPDX license list, `text/BSD-3-Clause.txt` |
| `CC-BY-4.0.txt` | the `angular` icon's artwork | `https://creativecommons.org/licenses/by/4.0/legalcode.txt` |
| `Apache-2.0.txt` | the `apache`, `apachekafka` and `apachespark` icons' artwork | the SPDX license list, `text/Apache-2.0.txt` |

## Two notes a reader should not have to reverse-engineer

**`Apache-2.0.txt` is not cairn's own licence.** cairn's grant is the root
[`../LICENSE`](../LICENSE), and it covers cairn's code. This copy is here
because three vendored icons declare Apache-2.0 for their *artwork*, which is a
separate grant from a separate rights-holder that happens to use the same text.
Keeping them as two files stops the root `LICENSE` from being read as though it
covered the marks.

**`BSD-3-Clause.txt` still has the SPDX `<year> <owner>` placeholders.** The
`openjdk` icon is declared BSD-3-Clause by simple-icons, and the artwork source
it records — a Mercurial URL on the now-retired `hg.openjdk.java.net` — does
not publish a copyright line, so there is no upstream notice to reproduce.
Filling the placeholders in would mean asserting a rights-holder and a year
that cairn cannot verify, which is worse than leaving them visibly blank.
Attribution for that icon is therefore to the artwork source URL named in
`THIRD-PARTY-NOTICES.md`.

If you are reviewing this for a release and want the placeholders resolved,
that is a question for the OpenJDK project, not something to guess at.
