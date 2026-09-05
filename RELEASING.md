# Releasing cairn

The release is fully driven by `.github/workflows/release.yml`, triggered by
pushing a version tag.

## The one rule: the tag is the source of truth

The pushed tag decides the version. The workflow derives it with
`VERSION="${GITHUB_REF_NAME#v}"` and passes it to `scripts/build-binaries.sh`,
which names the binaries, the checksums file, the GitHub Release, and the
Homebrew/Scoop artifacts from it. So:

- **The tag must be lowercase `vX.Y.Z`.** GitHub Actions tag globs are
  case-sensitive; the trigger is `tags: ["v*"]`, so `V1.0.0` (capital V) would
  never start the workflow.
- **You do not need to bump `package.json` first.** `build-binaries.sh` falls
  back to `package.json`'s `version` only for local/manual builds; in CI the tag
  wins. Keeping `package.json` in sync is nice for tidiness but is not required
  and is not committed back by the pipeline.

### The one exception: npm

`npm publish` ships `package.json`'s `version` — it has no idea what the tag
says. So the `publish` job runs

```sh
npm version "${GITHUB_REF_NAME#v}" --no-git-tag-version --allow-same-version
```

before publishing, which restores "the tag decides" for the npm channel too.
Without it every release would republish whatever version was last committed.
The bump is not committed back, exactly like the binaries.

## Cutting a release

```sh
git tag vX.Y.Z            # lowercase v; pre-releases fine, e.g. v1.0.0-rc01
git push origin vX.Y.Z
```

Then watch **repo → Actions → the `release` run**. Jobs run `test → binaries →`
then `publish` and `taps` in parallel. On success you get a GitHub Release with
5 binaries, a `cairn-X.Y.Z-licenses.tar.gz` bundle and a checksums file, fresh
commits in `R0kshan/homebrew-tap` and `R0kshan/scoop-bucket`, and
`@r0kshan/cairn` on npm.

## The licence bundle

`scripts/build-licenses.sh` (called by `build-binaries.sh`) packs `LICENSE`,
`THIRD-PARTY-NOTICES.md` and `licenses/` into `dist/cairn-X.Y.Z-licenses.tar.gz`,
which is checksummed and attested alongside the binaries. The three binary
channels unpack it — Homebrew into the formula's `doc`, Scoop into the app
directory, `packaging/install.sh` into `share/doc/cairn` after verifying its
sha256 — and `cairn version --licenses` prints the short form from inside the
binary itself.

npm is the exception and needs no bundle: `files` already ships `LICENSE`,
`THIRD-PARTY-NOTICES.md` and `licenses/` at the package root, so a consumer has
the texts the moment they install. The tarball exists for the channels that
distribute a bare executable with nothing alongside it.

This is one asset on purpose. The binaries inline elkjs (EPL-2.0), vendor Simple
Icons artwork and embed the Bun runtime with its LGPL-2.1 JavaScriptCore, so the
notices are not optional; a per-file list would mean editing four packaging files
every time a licence text is added, and forgetting is silent. **Bun is pinned**
(`bun-version` in `release.yml`) because the binaries redistribute that exact
runtime — keep it in step with `BUN_VERSION` in `src/notice.ts` and the copy of
Bun's `LICENSE.md` in `licenses/`. `tests/notice.test.ts` fails the build if
those drift apart.

## The npm channel

Published under a scope because the bare name `cairn` is taken on the registry.
The package has **two surfaces and no others**:

| Surface | Built by | Entry |
| --- | --- | --- |
| `cairn` command | `scripts/build-cli.sh` | `bin/cairn.mjs` |
| `import … from "@r0kshan/cairn"` | `scripts/build-api.sh` | `dist/cairn.mjs` |

Both are built by `prepack`, so `npm publish` / `npm pack` always ship fresh
bundles, and both are git-ignored — build artifacts, not source.

The engine bundle is built from `src/playground.ts`, not `src/api.ts`, because
`api.ts` injects no ELK factory: imported directly in a browser it would fall
through to `elk-worker.ts`, Node-shaped code with no business in a Vite build.
It is not minified — consumers run their own minifier over it, and an
unminified dependency is easier to debug through.

The `exports` map is what makes "two surfaces and no others" true rather than
merely intended. Without an `exports` field every file in the tarball is
deep-importable, and `bin/cairn.mjs` dispatches at module scope — so
`import "@r0kshan/cairn/bin/cairn.mjs"` would be a real entry point that prints
the help text as a side effect, and an undeclared one people could come to
depend on. `scripts/smoke-npm.sh` asserts both halves: the entry imports and
compiles a real diagram, and everything else stays shut.

Still missing, tracked in [#38](https://github.com/R0kshan/cairn/issues/38):
generated `.d.ts` declarations (`tsconfig.json` is `noEmit`, so this needs its
own build config) and a browser-usage section in the README. TypeScript
consumers get the engine but no types until then.

**Both surfaces ship pre-bundled.** `prepack` runs `scripts/build-cli.sh` and
`scripts/build-api.sh`, esbuilding `src/cli-npm.ts` → `bin/cairn.mjs` and
`src/playground.ts` → `dist/cairn.mjs`, elkjs inlined in each. Neither can ship
as TypeScript: Node refuses to strip types for files under `node_modules`, so
the `bin/cairn.js` launcher that works from a checkout is dead on install. The
`publish` job proves the tarball actually runs and imports
(`scripts/smoke-npm.sh`) before `npm publish`.

**The package installs zero dependencies.** `elkjs` is inlined into the bundle,
so it is a devDependency here and consumers never resolve it — declaring it
would make npm install a copy nothing loads, at a version that can drift from
the one actually compiled in. Supply-chain visibility comes from build
provenance instead: the OIDC publish attests the tarball to the commit and
`package-lock.json` that produced it, so the inlined elkjs version is
recoverable from the attestation rather than guessed from a dependency range.

**Dist-tag is derived from the tag.** A version containing `-` publishes to
`unstable`, anything else to `latest`. A prerelease therefore only moves the
`unstable` pointer.

**`latest` is stuck on the bootstrap version.** npm force-creates `latest` on a
package's first publish whatever `--tag` says, so the manual bootstrap pinned it
to whatever it published. Read the current value rather than trusting this doc —
it is the one number here that moves without a commit:

```sh
npm view @r0kshan/cairn dist-tags
```

| Command | Resolves to |
| --- | --- |
| `npm i @r0kshan/cairn@unstable` | newest prerelease |
| `npm i @r0kshan/cairn` | the bootstrap version, and stays there |

RC12, RC13 … ship to `unstable` and never move `latest`, so a bare install gets
more stale with each prerelease. Two ways out:

- `npm dist-tag rm @r0kshan/cairn latest` — CI never recreates it, so bare
  installs fail with `No matching version found` until the first stable tag, as
  originally intended. Untested; npm may refuse to remove `latest`.
- Leave it, and say `@unstable` explicitly in the README and integration docs.

## Verify the channels

```sh
curl -fsSL https://raw.githubusercontent.com/R0kshan/cairn/main/packaging/install.sh | sh
brew install R0kshan/tap/cairn
scoop bucket add cairn https://github.com/R0kshan/scoop-bucket && scoop install cairn
npm i -g @r0kshan/cairn@unstable
```

## If the workflow didn't run

1. **Tag case** — lowercase `v...`? Re-tag if not:
   `git tag -d vBad && git push origin :vBad`, then push the correct tag.
2. **Tag pushed to the remote?** `git ls-remote --tags origin`.
3. **Actions enabled** and the workflow on the default branch?

## Security posture (keep it)

- Every action is pinned to a commit SHA (the comment shows the human tag). One
  first-party exception (`actions/attest-build-provenance`) is on its major tag
  with a note; pin it when convenient.
- Least privilege: the default `GITHUB_TOKEN` is read-only; only the `binaries`
  job gets `contents`/`id-token`/`attestations: write`. Checkouts use
  `persist-credentials: false`.
- Downloads are checksum-verified (the curl installer fails closed on a
  mismatch) and every binary carries a build-provenance attestation:
  `gh attestation verify ./cairn-<ver>-<os>-<arch> --repo R0kshan/cairn`.
- **npm publishing uses OIDC trusted publishing — there is no `NPM_TOKEN`
  secret, and there should never be one.** The `publish` job gets a short-lived
  credential from the `id-token: write` permission, and npm attaches provenance
  for free. If you are ever tempted to add a token to unblock a failed publish,
  fix the trusted-publisher config instead.

## Local dry-run of the packaging step

```sh
npm run build:binaries                       # needs Bun; writes dist/cairn-* + licences + checksums
node scripts/render-packaging.mjs X.Y.Z dist/cairn-X.Y.Z-checksums.txt
# inspect dist/cairn.rb (Homebrew) and dist/cairn.json (Scoop)
```
