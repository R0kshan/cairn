// Records documentation/assets/cli-demo.gif — a terminal session that walks
// through the cairn commands. Every output shown is the real output of the
// command, captured through a pseudo-terminal (so colours match a real shell);
// only the typing is simulated. See scripts/demo-gif/README.md.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadChromium, framesToGif } from './lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'documentation', 'assets', 'cli-demo.gif');

// ---- 1. Run the session for real -------------------------------------------
const work = mkdtempSync(join(tmpdir(), 'cairn-demo-'));
const bin = join(work, '.bin');
mkdirSync(bin);
writeFileSync(join(bin, 'cairn'), `#!/bin/sh\nexec node --experimental-strip-types ${join(root, 'src', 'cli.ts')} "$@"\n`, { mode: 0o755 });

const session = [
  { note: 'scaffold a typed starter file' },
  { cmd: 'cairn new -A shop.cairn' },
  { note: 'reference an element that does not exist yet' },
  { cmd: `echo 'M1 -> PAYMENTS "Charge card" (HTTPS, JSON)' >> shop.cairn` },
  { cmd: 'cairn validate shop.cairn', hold: 2.6 },
  { cmd: 'cairn explain E0220', hold: 1.6 },
  { note: 'point the flow at the partner system instead' },
  { cmd: `sed -i 's/PAYMENTS/EXT1/' shop.cairn` },
  { cmd: 'cairn validate shop.cairn' },
  { clear: true },
  { note: 'render to SVG — label overlaps are measured on every build' },
  { cmd: 'cairn build shop.cairn --theme nord', preview: 'shop.svg', hold: 3.2 },
  { clear: true },
  { note: 'export the flow matrix — columns follow the view' },
  { cmd: 'cairn matrix shop.cairn --format md && cat shop.flow.md', hold: 3.5 },
];

const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, COLUMNS: '96', LINES: '40' };
for (const step of session) {
  if (!step.cmd) continue;
  // `script` gives the command a TTY so the CLI colours its output.
  // `cairn validate` exits 1 on errors — that output is the point, keep it.
  let raw;
  try { raw = execFileSync('script', ['-qec', step.cmd, '/dev/null'], { cwd: work, env, encoding: 'utf-8' }); }
  catch (e) { raw = e.stdout; }
  step.output = raw.replace(/\r/g, '').replace(/\n+$/, '');
  if (step.preview) step.svg = readFileSync(join(work, step.preview), 'utf-8');
}
rmSync(work, { recursive: true, force: true });

// ---- 2. Turn it into a timeline of frames ----------------------------------
const FPS = 12;
const frames = [];   // each: { lines: [...html], cursor: bool, svg?: string }
const lines = [];
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SGR = { 1: 'b', 2: 'dim', 31: 'red', 32: 'green', 33: 'yellow', 34: 'blue', 35: 'magenta', 36: 'cyan' };
function ansiToHtml(text) {
  let html = '', open = [];
  for (const part of text.split(/(\x1b\[[0-9;]*m)/)) {
    const m = /^\x1b\[([0-9;]*)m$/.exec(part);
    if (!m) { html += esc(part); continue; }
    for (const code of (m[1] || '0').split(';').map(Number)) {
      if (code === 0) { html += '</span>'.repeat(open.length); open = []; }
      else if (SGR[code]) { html += `<span class="${SGR[code]}">`; open.push(code); }
    }
  }
  return html + '</span>'.repeat(open.length);
}
const prompt = '<span class="prompt">~/shop</span> <span class="green">❯</span> ';
const push = (n, extra = {}) => { for (let i = 0; i < n; i++) frames.push({ lines: [...lines], cursor: Math.floor(frames.length / (FPS / 2)) % 2 === 0, ...extra }); };
const sec = s => Math.round(s * FPS);

push(sec(0.6));
let svg = null;
for (const step of session) {
  if (step.clear) { lines.length = 0; continue; }
  if (step.note) {
    lines.push(`<span class="comment"># ${esc(step.note)}</span>`);
    push(sec(0.5));
    continue;
  }
  lines.push(prompt);
  const at = lines.length - 1;
  for (let i = 1; i <= step.cmd.length; i += 2) {
    lines[at] = prompt + esc(step.cmd.slice(0, i));
    frames.push({ lines: [...lines], cursor: true, svg });
  }
  lines[at] = prompt + esc(step.cmd);
  push(sec(0.35), { svg });
  if (step.output) lines.push(...ansiToHtml(step.output).split('\n'));
  if (step.svg) { push(sec(1.4), { svg }); svg = step.svg; }   // read the build line, then open the SVG
  push(sec(step.hold ?? 1.1), { svg });
  if (step.preview) svg = null;   // the preview closes once the next command starts
}
push(sec(2.5));

// ---- 3. Render each frame in Chromium --------------------------------------
const page_html = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;background:#0d1117}
  .win{position:absolute;inset:16px;border-radius:10px;background:#161b22;box-shadow:0 8px 30px #0008;overflow:hidden;border:1px solid #30363d}
  .bar{height:30px;background:#21262d;display:flex;align-items:center;gap:8px;padding:0 12px}
  .bar i{width:12px;height:12px;border-radius:50%;display:block}
  .bar span{flex:1;text-align:center;color:#8b949e;font:13px system-ui,sans-serif;margin-right:60px}
  pre{margin:0;padding:14px 18px;color:#e6edf3;font:15px/1.45 "DejaVu Sans Mono",monospace;white-space:pre;height:calc(100% - 58px);overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end}
  .b{font-weight:bold}.dim{color:#8b949e}.red{color:#ff7b72}.green{color:#3fb950}.yellow{color:#d29922}.blue{color:#79c0ff}.magenta{color:#d2a8ff}.cyan{color:#56d4dd}
  .prompt{color:#79c0ff}.comment{color:#6e7681;font-style:italic}
  .cur{background:#e6edf3;color:#e6edf3}
  .preview{position:absolute;right:40px;bottom:40px;left:40px;top:70px;background:#fff;border-radius:8px;box-shadow:0 10px 40px #000a;display:flex;flex-direction:column;overflow:hidden}
  .preview .t{background:#eaeef2;font:13px system-ui,sans-serif;color:#57606a;padding:6px 10px}
  .preview .s{flex:1;display:flex;align-items:center;justify-content:center;padding:16px;background:#2e3440}
  .preview svg{max-width:100%;max-height:100%;height:auto}
</style><div class="win"><div class="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span>cairn — terminal</span></div><pre id="t"></pre></div><div id="p"></div>`;

const chromium = await loadChromium();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
await page.setContent(page_html);
const pngs = [];
let lastKey = null;
for (const [i, f] of frames.entries()) {
  const body = f.lines.join('\n') + (f.cursor ? '<span class="cur">▌</span>' : '');
  const key = body + (f.svg ? '#svg' : '');
  if (key !== lastKey) {
    await page.evaluate(([body, svg]) => {
      document.getElementById('t').innerHTML = `<div>${body}</div>`;
      document.getElementById('p').innerHTML = svg ? `<div class="preview"><div class="t">shop.svg</div><div class="s">${svg}</div></div>` : '';
    }, [body, f.svg]);
    lastKey = key;
  }
  pngs.push(await page.screenshot({ type: 'png' }));
  if (i % 100 === 0) process.stdout.write(`\r  frame ${i}/${frames.length}`);
}
await browser.close();
console.log(`\r  ${frames.length} frames`);
framesToGif(pngs, FPS, out, { width: 960 });
console.log(`✓ ${out}`);
