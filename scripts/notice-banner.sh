#!/usr/bin/env bash
# The legal notice prepended to every JavaScript artifact cairn ships.
#
# esbuild's `--legal-comments` only preserves comments it recognises as legal —
# `/*!`, `@license`, `@preserve`. elkjs' EPL header is a plain block comment, so
# minification drops it and the bundle would redistribute EPL-2.0 code with no
# notice attached. This banner states the same facts explicitly instead of
# depending on an upstream comment's punctuation.
#
# The text is NOT written here: `src/notice.ts` is the single source shared with
# `cairn licenses`, so the bundles and the binaries cannot drift apart. Source
# this file, then pass "$NOTICE_BANNER" to `--banner:js`.
NOTICE_BANNER="$(node --experimental-strip-types \
  "$(dirname "${BASH_SOURCE[0]}")/print-notice.mjs" --banner)"
