# cairn playground

Browser playground for **cairn** — architecture diagrams as code. The engine runs 100% client-side; a small Vercel serverless function additionally renders diagrams to SVG by URL (handy for embedding a diagram in a README, like a badge).

Structure (mirrors the `vercel-svg-badge-example` template):

```
playground/
  index.html            client UI (live editor + preview)
  cairn-engine.js        browser engine bundle (built)
  api/svg.mjs            serverless: GET /api/svg?src=… → image/svg+xml
  lib/engine.node.mjs    node engine bundle used by the function (built)
  vercel.json            static + function config
  package.json
```

## Build the bundles

From the repo root (needs `node`, no bun required):

```bash
bash scripts/build-playground.sh
```

This regenerates `cairn-engine.js` (browser) and `lib/engine.node.mjs` (node) from `src/`. Both are committed so Vercel needs no build step.

## Run locally

Static only:

```bash
npx serve playground
```

With the `/api/svg` function:

```bash
cd playground
npx vercel dev
```

## Deploy to Vercel

Import the repo at [vercel.com](https://vercel.com) and set **Root Directory** to `playground`. Leave the rest as default (framework preset: Other). Vercel serves the static files and turns `api/svg.mjs` into a function automatically.

## The /api/svg endpoint

```
GET /api/svg?src=<url-encoded DSL>
GET /api/svg?s=<base64 DSL>          # what the playground "Copy embed URL" produces
```

Returns `image/svg+xml`. Invalid DSL returns a 422 with an error SVG. Example embed in Markdown:

```md
![diagram](https://<your-app>.vercel.app/api/svg?s=ZGlhZ3JhbS4uLg==)
```
