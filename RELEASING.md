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

## Cutting a release

```sh
git tag vX.Y.Z            # lowercase v; pre-releases fine, e.g. v1.0.0-rc01
git push origin vX.Y.Z
```

Then watch **repo → Actions → the `release` run**. Jobs run
`test → binaries → taps`. On success you get a GitHub Release with 5 binaries +
a checksums file, and fresh commits in `R0kshan/homebrew-tap` and
`R0kshan/scoop-bucket`.

## Verify the channels

```sh
curl -fsSL https://raw.githubusercontent.com/R0kshan/cairn/main/packaging/install.sh | sh
brew install R0kshan/tap/cairn
scoop bucket add cairn https://github.com/R0kshan/scoop-bucket && scoop install cairn
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
- npm publishing is intentionally omitted — the bare name `cairn` is taken on the
  registry. To add it later, publish under a scoped name (`@<user>/cairn`) with
  an `NPM_TOKEN` secret and a job mirroring `binaries`.

## Local dry-run of the packaging step

```sh
npm run build:binaries                       # needs Bun; writes dist/cairn-* + checksums
node scripts/render-packaging.mjs X.Y.Z dist/cairn-X.Y.Z-checksums.txt
# inspect dist/cairn.rb (Homebrew) and dist/cairn.json (Scoop)
```
