# AGENTS.md

This repository's guidance for AI coding agents lives in **[CLAUDE.md](./CLAUDE.md)**.

Read it before making changes — it covers the runtime model (no build step;
TypeScript run directly on Node ≥ 22.6), the parse→validate→layout→render
pipeline, and the non-negotiable invariants (zero label overlaps, byte-
deterministic output, the snapshot gate). Contributor workflow is in
[CONTRIBUTING.md](./CONTRIBUTING.md).
