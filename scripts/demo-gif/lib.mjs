// Shared helpers for the README demo GIFs — see scripts/demo-gif/README.md.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Playwright is not a devDependency: these scripts are a one-off documentation
// chore, not part of dev, test or publish. Resolve a local or global install.
export async function loadChromium() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright'];
  try {
    const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf-8' }).trim();
    candidates.push(join(globalRoot, 'playwright'));
  } catch {}
  for (const c of candidates.filter(Boolean)) {
    try {
      const mod = createRequire(import.meta.url)(c);
      return mod.chromium;
    } catch {}
  }
  throw new Error('playwright not found — `npm i -g playwright` (or set PLAYWRIGHT_MODULE)');
}

// Init script for a recorded page: headless Chromium records no pointer, so
// draw one that tracks mouse events, and a caption bar (`#demo-caption`) that
// says what each step is for. Pass to `context.addInitScript`.
export function demoOverlay() {
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l14 9-6.5 1.2L14 19l-2.6 1.2-3.3-6.8L3 18z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: 2147483647, pointerEvents: 'none', transform: 'translate(-3px,-2px)' });
    document.body.appendChild(c);
    const move = e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; };
    addEventListener('pointermove', move, true);
    addEventListener('pointerdown', move, true);
    const cap = document.createElement('div');
    cap.id = 'demo-caption';
    Object.assign(cap.style, {
      position: 'fixed', right: '18px', bottom: '42px', zIndex: 2147483646, pointerEvents: 'none',
      maxWidth: '640px', padding: '9px 14px', borderRadius: '8px', display: 'none',
      background: 'rgba(13,17,23,.92)', color: '#e6edf3', border: '1px solid #3d444d',
      font: '15px/1.4 system-ui, sans-serif', boxShadow: '0 4px 18px rgba(0,0,0,.35)',
    });
    document.body.appendChild(cap);
  });
}

// Sets the caption bar's HTML; null hides it.
export async function setCaption(page, html) {
  await page.evaluate(h => {
    const cap = document.getElementById('demo-caption');
    cap.innerHTML = h ?? '';
    cap.style.display = h ? 'block' : 'none';
  }, html);
}

// A Playwright screen recording → GIF. `trim` seconds are cut from the start
// (setup the viewer should not sit through); `width` scales it down.
// mpdecimate drops the near-identical frames of every pause — most of a
// recording — and vfr keeps each remaining frame on screen for as long as it
// was; the flat UI needs no dithering, which would only add noise to every
// frame.
export function videoToGif(webm, out, { trim = 0, width } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-gif-'));
  const palette = join(dir, 'palette.png');
  const vf = `fps=8,mpdecimate=hi=768:lo=320:frac=0.4${width ? `,scale=${width}:-1:flags=lanczos` : ''}`;
  const input = ['-y', '-loglevel', 'error', '-ss', String(trim), '-i', webm];
  try {
    execFileSync('ffmpeg', [...input, '-vf', `${vf},palettegen=stats_mode=diff:max_colors=96`, palette]);
    execFileSync('ffmpeg', [...input, '-i', palette, '-lavfi',
      `${vf}[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle`, '-fps_mode', 'vfr', '-loop', '0', out]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (!existsSync(out)) throw new Error(`ffmpeg produced no ${out}`);
}
