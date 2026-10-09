# README demo GIFs

Regenerates `documentation/assets/cli-demo.gif` and
`documentation/assets/playground-demo.gif`.

```sh
node scripts/demo-gif/cli-demo.mjs          # VS Code: editor + integrated terminal
node scripts/demo-gif/playground-demo.mjs   # playground walkthrough
```

Needs `ffmpeg`, `python3` (serves `playground/`), Playwright with Chromium,
and for the CLI demo [code-server](https://github.com/coder/code-server) —
VS Code in the browser. Its standalone release bundles the Node it needs; put
`code-server` on the PATH or set `CODE_SERVER=/path/to/bin/code-server`.
Neither is a devDependency — this is an occasional docs chore, not part of
dev, test or publish; the scripts resolve a local or global Playwright, or
`PLAYWRIGHT_MODULE=/path/to/playwright`.

- **CLI** — a real VS Code (code-server, with a throwaway profile and
  workspace) and a real shell running the CLI from `src/`: the `.cairn` source
  is edited in the editor, every command runs in the integrated terminal, and
  the SVG opens in VS Code's image preview, which `cairn watch` keeps fresh.
  Only the mouse and keyboard are scripted. Edit the steps in
  `cli-demo.mjs`; `STEPS=<dir>` saves a PNG after each one.
- **Playground** — drives the committed `playground/` build, i.e. what Vercel
  serves. Rebuild it first (`npm run build:playground`) if `src/` changed.
  Each step fixes something the automatic layout really got wrong, and a
  caption says what. Grab points are found by hovering until the playground's
  cursor changes and drop points are measured from the live drawing, so small
  layout changes are absorbed — but if the template or the layout engine
  changes, re-check the frames: every action should visibly improve the
  diagram, not just move something. `STEPS=<dir>` saves a PNG after each step
  for that review.
