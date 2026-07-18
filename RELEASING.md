# Releasing cairn

## Cutting a release

1. **Bump the version** so the tag matches `package.json` (the binary asset names are derived from `package.json`'s version; the formula/manifest are derived from the tag — they must agree):

   ```sh
   # edit "version" in package.json to X.Y.Z, then:
   git commit -am "release vX.Y.Z"
   ```

2. **Tag and push:**

   ```sh
   git tag vX.Y.Z
   git push origin main --tags
   ```

3. **Watch it run:** cairn repo → Actions → the `release` run. On success you'll have a GitHub Release with 5 binaries + checksums, and fresh commits in `homebrew-tap` and `scoop-bucket`.

4. **Verify the channels:**

   ```sh
   curl -fsSL https://raw.githubusercontent.com/R0kshan/cairn/main/packaging/install.sh | sh
   brew install R0kshan/tap/cairn
   scoop bucket add cairn https://github.com/R0kshan/scoop-bucket && scoop install cairn
   ```

## Security posture

- **Downloads are verified.** The curl installer fetches `cairn-<ver>-checksums.txt` from the release and refuses to install unless the binary's sha256 matches (fail-closed). Homebrew and Scoop verify their own sha256 too.
- **Build provenance.** Each release attaches a signed provenance attestation. Anyone can verify a binary came from this workflow:

  ```sh
  gh attestation verify ./cairn-<ver>-<os>-<arch> --repo R0kshan/cairn
  ```

- **Pinned actions.** All GitHub Actions are pinned to commit SHAs (the comment shows the tag). One exception: `actions/attest-build-provenance@v2` is still on its tag because its SHA couldn't be resolved when this was written — pin it when convenient:

  ```sh
  gh api repos/actions/attest-build-provenance/commits/v2 --jq .sha
  # then replace @v2 with @<sha> # v2 in .github/workflows/release.yml
  ```

- **Least privilege.** The workflow's default token is read-only; only the `binaries` job gets `contents/id-token/attestations: write`. Checkouts use `persist-credentials: false`.
- **Residual, by design:** binaries aren't code-signed/notarized (the installer strips the macOS quarantine flag), and the tap push embeds the token in the clone URL (masked in logs, ephemeral runner). Both are acceptable trade-offs for a project this size; revisit if you start distributing widely.

## Local dry-run of the packaging step

You can render the formula + manifest locally without tagging (requires the built binaries + a checksums file):

```sh
npm run build:binaries                     # needs Bun; writes dist/cairn-* and dist/cairn-<ver>-checksums.txt
node scripts/render-packaging.mjs X.Y.Z dist/cairn-X.Y.Z-checksums.txt
# inspect dist/cairn.rb and dist/cairn.json
```

## Create the tag

Tagging `vX.Y.Z` triggers `.github/workflows/release.yml`, which:

1. runs the test suite,
2. compiles self-contained binaries for 5 platforms (Linux/macOS ×x64/arm64, Windows x64) with Bun,
3. creates the GitHub Release and uploads the binaries + a checksums file,
4. renders the Homebrew formula and Scoop manifest with the real version + sha256s, and pushes them to the tap/bucket repos.

The **curl**, **Homebrew**, and **Scoop** install channels all serve those release binaries, so they start working the moment the first release finishes. (npm publishing is disabled — the name `cairn` is taken on the registry; see the `npm` job in the workflow to re-enable with a scoped name.)