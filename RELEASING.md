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

Then watch **repo → Actions → the `release` run**. Jobs run `test → binaries →
taps`, with `publish` in parallel after `test`. On success you get a GitHub
Release with 5 binaries + a checksums file, fresh commits in
`R0kshan/homebrew-tap` and `R0kshan/scoop-bucket`, and `@r0kshan/cairn` on npm.

## The npm channel

Published under a scope because the bare name `cairn` is taken on the registry.
Today the package ships the **CLI** only; the importable engine surface is
tracked in [#38](https://github.com/R0kshan/cairn/issues/38), so
`import … from "@r0kshan/cairn"` does not resolve yet — by design, not oversight.

**The CLI ships pre-bundled.** `prepack` runs `scripts/build-cli.sh`, which
esbuilds `src/cli-npm.ts` into `bin/cairn.mjs` with elkjs inlined. It cannot ship
as TypeScript: Node refuses to strip types for files under `node_modules`, so
the `bin/cairn.js` launcher that works from a checkout is dead on install. The
`publish` job proves the tarball actually runs (`scripts/smoke-npm.sh`) before
`npm publish`.

**The package installs zero dependencies.** `elkjs` is inlined into the bundle,
so it is a devDependency here and consumers never resolve it — declaring it
would make npm install a copy nothing loads, at a version that can drift from
the one actually compiled in. Supply-chain visibility comes from build
provenance instead: the OIDC publish attests the tarball to the commit and
`package-lock.json` that produced it, so the inlined elkjs version is
recoverable from the attestation rather than guessed from a dependency range.

**Dist-tag is derived from the tag.** A version containing `-` (e.g.
`v1.0.0-rc11`) publishes to `unstable`; anything else to `latest`. That keeps
`npm i @r0kshan/cairn` from handing people a release candidate.

**Until the first stable release there is no `latest`.** npm resolves a bare
install to the `latest` dist-tag, and publishing only to `unstable` never
creates one — so `npm i @r0kshan/cairn` fails with `No matching version found`
until you tag a version without a `-`. That is the intended trade, but it means
the README and any integration instructions must say `@unstable` explicitly.
Revisit both when you cut the first stable tag.

### One-time bootstrap (before the first tagged release)

npm's trusted publishing is configured *on an existing package*, so the first
publish is manual and the workflow takes over afterwards:

```sh
npm login
npm publish --tag unstable        # --access public comes from publishConfig
```

Then on npmjs.com → the package → **Settings → Trusted Publisher**, add GitHub
Actions with repo `R0kshan/cairn` and workflow `release.yml`. From then on every
tag publishes over OIDC with **no NPM_TOKEN in this repo**, and npm attaches
build provenance automatically.

If the `publish` job fails with an auth error, it is almost always that config
missing or naming the wrong workflow file.

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
npm run build:binaries                       # needs Bun; writes dist/cairn-* + checksums
node scripts/render-packaging.mjs X.Y.Z dist/cairn-X.Y.Z-checksums.txt
# inspect dist/cairn.rb (Homebrew) and dist/cairn.json (Scoop)
```
