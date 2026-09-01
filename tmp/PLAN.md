# Plan — issue #21: `--theme` CLI flag, with custom theme files

## What the issue asks for

"Add cli parameter to allow the use of custom themes." The issue body is empty,
so the shape below was agreed with the maintainer:

- A custom theme is a JSON file that **extends a built-in** and overrides only
  what it wants. A two-line file is a valid theme.
- One flag, `--theme <name|path>`. A value ending in `.json` is loaded as a
  file; anything else is a built-in name.

## Why the CLI has nothing today

`style { theme: … }` in the DSL is the only way to pick a theme. `compile()`
accepts `theme`, but no CLI verb does — so today you cannot re-render the same
diagram in another theme without editing it.

## Constraints found in the code

1. **The parser validates `theme:` against a closed set** (`parser.ts:690`,
   `new Set(themeNames)`). A custom name would be rejected at parse time, so the
   CLI applies its theme *after* parsing — the same thing `compile()` already
   does at `compile.ts:54`.
2. **Dark-vs-light is a hardcoded list** (`svg-render.ts:1247`,
   `["dark","nord","classic-dark"]`) and it selects the flow palette. A custom
   dark theme would silently get light flow colours, so the file format needs
   its own `dark` flag and the list has to become a lookup.
3. **The core must stay filesystem-free** (INVARIANTS §12). Reading the theme
   file belongs in the CLI, exactly as `logo-files.ts` does for `logo:`.
4. **The matrix SVG reads `palettes[…]`** (`flow-matrix.ts:140`), a map holding
   only `light` and `dark`. A registered custom theme must be added there too.

## Steps

1. `themes.ts` — extract the inline specs into `THEME_SPECS`, build `themes`
   from it, export the `ThemeSpec` type, add `dark?: boolean`, replace the
   hardcoded dark list with `isDarkTheme(name)`, and add `registerTheme()` and
   `themeSpec()`.
2. `theme-file.ts` (new) — read the JSON, validate it, deep-merge over the base
   named by `extends`, and return the spec plus diagnostics. No core imports.
3. `cli.ts` — `--theme` as a value flag, resolved once and applied post-parse to
   `model.style.theme`; wired through `build`, `matrix` and `watch`.
4. Docs — README, `documentation/DSL_SPEC.md`, CLI usage text; an example theme
   file so the format is copy-pasteable.
5. Tests — resolution, merge, dark flag, bad input, and CLI end-to-end.

## Out of scope

- Built-in themes other than `light`/`dark` are missing from `palettes`, so
  their matrix SVGs already fall back to light. Pre-existing; report, don't fix.
- No DSL syntax for a theme file (`theme: "./x.json"`). The issue asks for a CLI
  parameter, and a DSL path would put filesystem work back in the parser.
