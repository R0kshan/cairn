#!/usr/bin/env bash
# Smoke-test the package as npm actually delivers it.
#
# Every other gate runs from the repo: `npm test` executes src/*.ts through
# --experimental-strip-types, and smoke-binary.sh tests the Bun binary. Neither
# can see the failure modes that matter here. Node refuses to strip types under
# node_modules, so a package that works perfectly from a checkout can still ship
# a CLI that won't start; and a `files`/`exports` mismatch publishes cleanly and
# only breaks at a consumer's `import`.
#
# This packs, installs into a throwaway consumer, and exercises both published
# surfaces from there — the *installed* `cairn` command and the `.` import —
# which covers prepack, `files`, the `bin` mapping, the `exports` map and both
# bundles together.
#
# Usage:
#   scripts/smoke-npm.sh              # pack, install, smoke
#   scripts/smoke-npm.sh <version>    # also assert both surfaces report exactly
#                                     # this version (the release job passes the
#                                     # tag here — see release.yml)
set -euo pipefail
cd "$(dirname "$0")/.."

EXPECTED_VERSION="${1:-}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

echo "• packing…"
# Never `--silent` here: it gags npm's own error output too, so a failing
# `prepack` (a missing devDependency, a broken bundle) aborted this script with
# no diagnostic at all — the one thing a CI gate must not do. Capture the
# streams instead and dump both on failure.
#
# `--json` gives the tarball name as data rather than "whatever the last line
# was", which `prepack`'s own stdout can shift. That output is prepended to the
# JSON, hence the slice to the first line that is exactly `[`.
if ! npm pack --json --pack-destination "$TMP" >"$TMP/pack.out" 2>"$TMP/pack.err"; then
  echo "✗ npm pack failed — prepack (build-cli.sh / build-api.sh) is the usual culprit:" >&2
  cat "$TMP/pack.err" "$TMP/pack.out" >&2
  exit 1
fi
TARBALL="$(node -e '
  const fs = require("node:fs");
  const out = fs.readFileSync(process.argv[1], "utf8");
  const start = out.search(/^\[$/m);
  if (start < 0) throw new Error("npm pack --json produced no JSON:\n" + out);
  process.stdout.write(JSON.parse(out.slice(start))[0].filename);
' "$TMP/pack.out")"

echo "• installing $TARBALL into a scratch consumer…"
mkdir -p "$TMP/consumer"
(
  cd "$TMP/consumer"
  npm init -y >/dev/null
  # Also un-silenced, for the same reason — `--loglevel=error` keeps it to one
  # line on success while leaving failures readable.
  npm install --no-audit --no-fund --loglevel=error "$TMP/$TARBALL"
)

PKG_DIR="$TMP/consumer/node_modules/@r0kshan/cairn"
# Read the bin target from the INSTALLED manifest rather than hardcoding it, so
# a `bin` entry pointing at a file `files` didn't ship fails right here. The
# `cd` keeps the path relative — under Git Bash, node is a Windows binary and
# can't resolve an MSYS path like /tmp/....
BIN_REL="$(cd "$PKG_DIR" && node -p "require('./package.json').bin.cairn")"
BIN_TARGET="$PKG_DIR/$BIN_REL"
[ -f "$BIN_TARGET" ] || { echo "✗ bin target missing from the tarball: $BIN_REL"; exit 1; }

# The bundles inline elkjs (EPL-2.0), which obliges us to distribute its license
# with them — and elkjs is a devDependency, so a consumer's node_modules has no
# copy to fall back on. A `files` typo publishes cleanly and only shows up as a
# licensing gap, so assert the paperwork actually shipped. See
# THIRD-PARTY-NOTICES.md.
for LICENSE_FILE in LICENSE THIRD-PARTY-NOTICES.md; do
  [ -f "$PKG_DIR/$LICENSE_FILE" ] || {
    echo "✗ $LICENSE_FILE missing from the tarball — check \`files\` in package.json"; exit 1;
  }
done

# Every text in licenses/, not just elkjs': the notice cites all of them, and a
# cited text that didn't ship is exactly the gap this check exists to catch.
# Compared against the working tree so adding a licence never means editing this
# list — `files` ships the directory, so the two must match entry for entry.
for LICENSE_FILE in licenses/*; do
  [ -f "$PKG_DIR/$LICENSE_FILE" ] || {
    echo "✗ $LICENSE_FILE missing from the tarball — check \`files\` in package.json"; exit 1;
  }
done

# The bundle's own `/*!` banner is the notice that travels with the code itself,
# and `--minify` is what strips this kind of comment. If it is gone, the tarball
# ships EPL-2.0 code with nothing attached to it.
head -c 4096 "$BIN_TARGET" | grep -q "EPL-2.0" || {
  echo "✗ $BIN_REL has no third-party notice banner — see scripts/notice-banner.sh"; exit 1;
}

BIN="$TMP/consumer/node_modules/.bin/cairn"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    # npm's POSIX shim hardcodes a Windows node path Git Bash can't exec
    # ("C:/Program: No such file or directory"). Drive the installed entry
    # directly instead — that still covers prepack, `files`, the bin mapping and
    # the bundle itself; only npm's own shim goes unexercised, and CI covers it.
    # `cygpath -m` gives a forward-slash Windows path: native node understands
    # it, and unlike `-w` it survives shell quoting without backslash escapes.
    echo "⚠ Windows shell — invoking the installed entry directly; the .bin shim is covered in CI"
    BIN="$TMP/cairn-run"
    printf '#!/usr/bin/env bash\nexec node "%s" "$@"\n' "$(cygpath -m "$BIN_TARGET")" > "$BIN"
    chmod +x "$BIN"
    ;;
  *)
    [ -x "$BIN" ] || { echo "✗ npm did not link an executable at $BIN"; exit 1; }
    ;;
esac

# Reuse the binary smoke: it drives build → matrix → explain (+ version) through
# whatever executable it's handed, so the npm CLI is held to the same bar as the
# compiled binaries.
# The npm bundles are built with esbuild, not `bun build --compile`, so this
# artifact embeds no Bun runtime and its notice must not claim one.
CAIRN_SMOKE_EMBEDS_BUN=0 bash scripts/smoke-binary.sh "$BIN" "$EXPECTED_VERSION"

# The package has two surfaces — the `cairn` command and the `.` import — and
# nothing else. Both halves are asserted here because both fail silently: a
# `files`/`exports` mismatch publishes cleanly and only breaks at a consumer's
# `import`, and dropping the exports map re-opens every shipped file without
# breaking anything visible. `bin/cairn.mjs` dispatches at module scope, so an
# unguarded deep import of it would print the help text as a side effect.
echo "• checking the package's import surface…"
# Absolute, because the check runs from the scratch consumer.
FIXTURE="$PWD/examples/application-medium.cairn"
(
  cd "$TMP/consumer"
  node --input-type=module -e '
    const { readFileSync } = await import("node:fs");

    const [fixture, expectedVersion] = process.argv.slice(1);

    // The entry a consumer actually writes: `import { compile } from "@r0kshan/cairn"`.
    const engine = await import("@r0kshan/cairn");

    // Exact set, not a subset. src/api.ts claims to be the only place the public
    // contract can change, but the published bundle is built from playground.ts,
    // which re-exports it — so an `export` added there would widen the surface
    // with api.ts untouched. Asserting the whole set is what makes that claim
    // true; a presence-only check would let the surface grow silently, and a
    // published export cannot be withdrawn.
    // Unfiltered on purpose: a stray `default` is exactly the kind of export
    // that appears by accident and cannot be withdrawn once published.
    const actual = Object.keys(engine).sort();
    const expected = [
      "ThemeSpecError",
      "compile",
      "matrixCsv",
      "matrixMd",
      "matrixSvg",
      "resolveThemeSpec",
      "themeNames",
      "version",
    ].sort();
    if (actual.join() !== expected.join()) {
      throw new Error(`published surface is [${actual}], expected [${expected}]`);
    }

    // The CLI half asserts its version against the tag; hold the import half to
    // the same bar. The two bundles read package.json independently at build
    // time, so nothing else would catch one of them drifting.
    if (expectedVersion && engine.version !== expectedVersion) {
      throw new Error(`entry reports version ${engine.version}, expected ${expectedVersion}`);
    }

    // Resolving is not the same as working — drive a real diagram through it.
    // A bundle can import cleanly and still carry an unresolved dependency that
    // only throws once the pipeline reaches it.
    const result = await engine.compile(readFileSync(fixture, "utf8"));
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    if (errors.length) throw new Error(`compile() reported errors: ${JSON.stringify(errors)}`);
    if (!result.svg?.startsWith("<svg")) throw new Error("compile() returned no svg");

    // The whole reason an embedder passes a spec rather than a name, driven
    // through the artifact they install. The unit tests cover this against
    // `src/`, which is a different build: this entry is bundled from
    // playground.ts by esbuild, so a theme module that failed to inline — or
    // reached for a Node API the browser target drops — would leave every
    // src-level test green and hand the embedder a diagram in default light.
    const ODD_BG = "#123456";
    const themed = await engine.compile(readFileSync(fixture, "utf8"), {
      theme: { extends: "dark", dark: true, pal: { bg: ODD_BG } },
    });
    if (!themed.svg?.includes(ODD_BG)) {
      throw new Error(`compile() ignored the custom theme — no ${ODD_BG} in the svg`);
    }

    // The other half of the contract: a theme that cannot be honoured is an
    // error, never a silent fall back to the default palette. Worth asserting
    // here because the class has to survive bundling to be catchable by name.
    await engine
      .compile(readFileSync(fixture, "utf8"), { theme: { pal: { bg: "notacolour" } } })
      .then(
        () => {
          throw new Error("compile() accepted a malformed theme");
        },
        (error) => {
          if (!(error instanceof engine.ThemeSpecError)) throw error;
        },
      );

    // Everything else stays shut, or it becomes surface we did not choose to
    // support and cannot withdraw once published.
    const resolves = async (specifier) => {
      try {
        await import(specifier);
        return true;
      } catch (error) {
        if (error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED") return false;
        throw error;
      }
    };
    if (await resolves("@r0kshan/cairn/bin/cairn.mjs")) {
      throw new Error("bin/cairn.mjs is importable — the exports map is too permissive");
    }

    // ...except the manifest, or tooling that inspects installed packages breaks.
    const { default: manifest } = await import("@r0kshan/cairn/package.json", { with: { type: "json" } });
    if (!manifest.version) throw new Error("@r0kshan/cairn/package.json is not reachable");
  ' "$FIXTURE" "$EXPECTED_VERSION"
) || { echo "✗ import surface check failed"; exit 1; }

echo "✓ npm package smoke passed — the published CLI runs and the package entry imports and compiles"
