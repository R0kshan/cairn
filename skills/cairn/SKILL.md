---
name: cairn
description: Write, fix and render architecture diagrams with cairn (.cairn files) — logical, application and infrastructure views, and the flow matrix (matrice des flux techniques). Use when the user asks for an architecture logique, applicative or physique / infrastructure diagram, a flow matrix, or works on a .cairn file.
license: Apache-2.0
---

# cairn

cairn compiles a small DSL into typed architecture views (SVG) and their flow
matrix. You don't know this DSL yet. Don't guess it from PlantUML or Mermaid:
read the spec, then let the compiler check your work.

1. **Find cairn.** Run `cairn version`. If cairn isn't installed, use
   `npx -y @r0kshan/cairn@unstable` wherever these steps say `cairn`.
   Prereleases are published under `unstable`, so plain `@r0kshan/cairn` can
   install an older release.

2. **Read the spec for that version.** `cairn version` prints `cairn vX.Y.Z…`.
   Fetch the spec at that tag and read it before you write anything:
   `https://raw.githubusercontent.com/R0kshan/cairn/vX.Y.Z…/documentation/DSL_SPEC.md`
   If that tag doesn't exist (a local build), use `main` instead of the tag.
   The spec describes what each view is for, which kinds it allows, the
   nesting rules, and what each flow must carry.

3. **Write one file per view.** Start from `cairn new -L|-A|-I <file.cairn>` if
   that helps (logical, application or infrastructure). If the request is
   ambiguous, ask, or state the assumptions you made.

4. **Validate and fix until it's clean:**
   `cairn validate <file.cairn> --strict --format json`.
   Fix every error and every warning. Each one has a code, a position, a hint,
   and often a fix you can apply as given. Run `cairn explain <CODE>` when the
   hint isn't enough. Repeat until the exit code is 0.

5. **Build:** `cairn build <file.cairn> -o <file.svg>`. Aim for
   `label overlaps: 0`. If a view is too dense, try `flow-text: numbered`,
   another `disposition`, or splitting the view. Don't use pixel offsets.

6. **Flow matrix**, if asked: `cairn matrix <file.cairn> --format csv|md|svg`.

7. **Hand back** the `.cairn` source (the SVG is generated from it), the SVG,
   the matrix if one was asked for, and your assumptions.
