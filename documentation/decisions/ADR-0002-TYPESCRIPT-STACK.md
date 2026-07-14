# ADR-0002: Use TypeScript with Bun-compiled binaries


## Context

Cairn's hot path is the layout engine call. Every build runs elkjs, which only exists outside Java as a JavaScript library. The hosting language must therefore either run JavaScript natively or bridge to it.

Additional constraints:
1. **Self-contained distribution** — users should install one binary, not
 `npm i -g cairn && node ...`
2. **Cross-platform** — macOS, Linux (x64 + arm64), Windows x64
3. **Live-preview performance** — `cairn watch` needs edit→preview in under
 ~300 ms to feel live
4. **Code sharing** — CLI and browser playground must share the same engine

## Options considered

| Option | ELK bridge | Distribution | Performance | Decision |
|---|---|---|---|---|
| **TypeScript (via Bun)** | `import ELK from 'elkjs'` — zero bridge | `bun build --compile` → self-contained binary (~50–100 MB) | ✅ V8-native: 36–414 ms for realistic diagrams | **Selected** |
| Go (via goja) | goja embeds elkjs; pure-Go JS interpreter, no JIT | Single binary (Go's native strength, ~30–40 MB) | ❌ Estimated ~20× slower: ~0.7–8 s on realistic diagrams — blows the watch budget | Eliminated |
| Rust/WASM | wasm-bindgen bridge, or compile elkjs to WASM | Single binary via Zig/cc | ◑ Future potential if we write a custom engine; doubles MVP cost now | Rejected for now |
| Node-only (no binary) | Direct import | `npm i -g cairn` + global Node dep | ✅ V8-native | Rejected — requires Node ≥ 22.6, not self-contained |

## Decision

**Use TypeScript for the entire codebase, with Bun `build --compile` producing self-contained binaries for distribution. The npm channel (`npm i -g cairn`) is a secondary distribution path for Node users.**

### Distribution channels (priority order)

1. **Homebrew** (macOS/Linux) — self-contained binary via own tap
2. **Scoop** (Windows) — self-contained binary via own bucket
3. **curl installer** + GitHub Releases — self-contained binary for everything
 else
4. **npm** (`npm i -g cairn`) — dev-ecosystem channel, requires Node ≥ 22.6

### Binary size

~50–60 MB on macOS/Linux, ~100 MB on Windows (Bun embeds the full JS runtime). For comparison, D2's Go release binaries are ~30–40 MB. The size gap is real but not decisive for this market — architecture tools are installed once per workstation, not deployed in containers.

### Node version requirement

The npm launcher (`bin/cairn.js`) re-executes Node with `--experimental-strip-types` for Node 22.6–23.5. Node ≥ 23.6 strips types by default. The npm package should declare `"engines": { "node": ">=22.6" }` in `package.json`.

## Consequences

### Positive
- **Zero bridge cost** to the layout hot path — ELK runs at V8 speed.
- **Same code in CLI and playground** — the browser bundle uses the same parser, views, layout, and diagnostics as the CLI.
- **Deterministic output** — verified byte-identical across Node and Bun runtimes, including th slide-fold multi-candidate path.
- **Familiar ecosystem** — TypeScript is the most widely used typed language in the diagram/developer-tools space, lowering the contribution barrier.

### Negative
- Binary size is 2–3× larger than a Go equivalent (~90 MB vs ~30 MB). This is a perceptual cost for users who `curl | sh` a binary.
- `bun build --compile` is relatively new (2024) — edge cases exist:
  - The `self` global (Bun defines it, flipping elkjs's UMD into browser mode) required a workaround (hide `self` during require, use fake sync worker).
  - Windows cross-compilation is listed as a target but untested as of
 v0.1.0-rc.
  - Bun's worker-embedding path didn't pick up elkjs's worker file — the sync route avoids this entirely for the CLI, and the browser playground uses a real web worker natively.
- Terminal-graphics preview needs SVG→raster in-process — plan to use
 **resvg-wasm** (pure WASM, bundleable) rather than sharp (native module, hostile to `--compile`).

### Neutral
- The npm channel gives Node users an option without downloading a binary, at the cost of requiring Node ≥ 22.6 and the `--experimental-strip-types` flag.
- The `bun build --compile` step is part of the release workflow — developers don't need Bun installed for day-to-day development (Node is sufficient).

## Links

- [RESULTS.md](/documentation/research/elk-test/RESULTS.md) — layout time comparison (Node vs Go+goja estimate)
- [Bun `--compile` documentation](https://bun.com/docs/bundler/executables)
- [Design brief §2.3](/documentation/DESIGN_BRIEF.md) — original stack evaluation
