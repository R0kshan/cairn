#!/usr/bin/env bash
# The legal notice prepended to every JavaScript artifact cairn ships.
#
# esbuild's `--legal-comments` only preserves comments it recognises as legal —
# `/*!`, `@license`, `@preserve`. elkjs' EPL header is a plain block comment, so
# minification drops it and the bundle would redistribute EPL-2.0 code with no
# notice attached. This banner states the same facts explicitly instead of
# depending on an upstream comment's punctuation, and `/*!` keeps it through
# `--minify`.
#
# Source it, then pass "$NOTICE_BANNER" to `--banner:js`. Keep it in step with
# THIRD-PARTY-NOTICES.md, which carries the full texts and the per-icon table.
NOTICE_BANNER='/*! cairn — Apache-2.0 — https://github.com/R0kshan/cairn
 * Bundles elkjs 0.12.0, (c) 2017 Kiel University and others.
 *   EPL-2.0 OR GPL-3.0-or-later; cairn elects EPL-2.0.
 *   License: https://www.eclipse.org/legal/epl-2.0
 * Embeds Simple Icons artwork (CC0-1.0), some icons under their own
 *   MIT, BSD-3-Clause, CC-BY-4.0 or Apache-2.0 terms.
 * Full license texts and per-icon attribution: THIRD-PARTY-NOTICES.md,
 *   https://github.com/R0kshan/cairn/blob/main/THIRD-PARTY-NOTICES.md
 */'
