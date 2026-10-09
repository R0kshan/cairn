# README demo GIFs

Regenerates `documentation/assets/cli-demo.gif` and
`documentation/assets/playground-demo.gif`.

```sh
node scripts/demo-gif/cli-demo.mjs          # terminal session
node scripts/demo-gif/playground-demo.mjs   # playground walkthrough
```

Needs `ffmpeg`, `script` (util-linux), `python3` (serves `playground/`) and
Playwright with Chromium. Playwright is deliberately **not** a devDependency —
this is an occasional docs chore, not part of dev, test or publish; the scripts
resolve a local or global install, or `PLAYWRIGHT_MODULE=/path/to/playwright`.

- **CLI** — the commands really run in a temp directory through a
  pseudo-terminal, so every output (colours included) is genuine; only the
  typing is simulated. Edit the `session` list to change the story.
- **Playground** — drives the committed `playground/` build, i.e. what Vercel
  serves. Rebuild it first (`npm run build:playground`) if `src/` changed.
  Each step fixes something the automatic layout really got wrong, and a
  caption says what. Grab points are found by hovering until the playground's
  cursor changes and drop points are measured from the live drawing, so small
  layout changes are absorbed — but if the template or the layout engine
  changes, re-check the frames: every action should visibly improve the
  diagram, not just move something. `STEPS=<dir>` saves a PNG after each step
  for that review.
