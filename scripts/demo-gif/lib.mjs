// Shared helpers for the README demo GIFs — see scripts/demo-gif/README.md.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
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

// PNG buffers → optimised GIF via ffmpeg's two-pass palette.
export function framesToGif(pngs, fps, out, { width } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-gif-'));
  pngs.forEach((buf, i) => writeFileSync(join(dir, `f${String(i).padStart(5, '0')}.png`), buf));
  const scale = width ? `scale=${width}:-1:flags=lanczos,` : '';
  const input = ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(dir, 'f%05d.png')];
  const palette = join(dir, 'palette.png');
  execFileSync('ffmpeg', [...input, '-vf', `${scale}palettegen=stats_mode=diff:max_colors=128`, palette]);
  execFileSync('ffmpeg', [...input, '-i', palette, '-lavfi',
    `${scale}paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, '-loop', '0', out]);
  rmSync(dir, { recursive: true, force: true });
  if (!existsSync(out)) throw new Error(`ffmpeg produced no ${out}`);
}
