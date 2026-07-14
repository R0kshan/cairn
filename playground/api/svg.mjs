// Vercel serverless function — server-side diagram rendering.
//
// Mirrors the R0kshan/vercel-svg-badge-example pattern: a GET endpoint that
// returns an `image/svg+xml` response, so a diagram can be embedded by URL in a
// README, wiki, or docs page (just like a badge).
//
//   GET /api/svg?src=<url-encoded DSL>
//   GET /api/svg?s=<base64 DSL>          (matches the playground "Copy embed URL")
//
// The engine is a self-contained bundle in ../lib/engine.node.mjs (elkjs
// inlined), so the function has no runtime dependencies to install.

import { compile, version } from '../lib/engine.node.mjs';

function errSvg(msg) {
  const t = String(msg).replace(/[<&]/g, c => (c === '<' ? '&lt;' : '&amp;'));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="60" role="img" aria-label="${t}">` +
    `<rect width="560" height="60" fill="#fff2f0" stroke="#ffb4ab"/>` +
    `<text x="14" y="35" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="13" fill="#b3261e">${t}</text></svg>`;
}

export default async function handler(req, res) {
  try {
    const u = new URL(req.url, 'http://localhost');
    let src = u.searchParams.get('src') || '';
    const b64 = u.searchParams.get('s');
    if (b64) {
      try { src = Buffer.from(b64.replace(/ /g, '+'), 'base64').toString('utf8'); } catch { /* ignore */ }
    }

    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (!src.trim()) {
      res.statusCode = 200;
      res.setHeader('Cache-Control', 'no-store');
      res.end(errSvg(`cairn engine v${version} — pass ?src=<dsl> or ?s=<base64>`));
      return;
    }

    const r = await compile(src);
    if (!r.svg) {
      const e = r.diagnostics.find(d => d.severity === 'error');
      res.statusCode = 422;
      res.setHeader('Cache-Control', 'no-store');
      res.end(errSvg(`line ${e?.span?.line ?? '?'}: ${e?.message ?? 'invalid diagram'}`));
      return;
    }

    res.statusCode = 200;
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400');
    res.end(r.svg);
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.end(errSvg('engine error: ' + e.message));
  }
}
