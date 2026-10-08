// Records documentation/assets/playground-demo.gif — the playground driven by
// a scripted mouse and keyboard: pick a template, type a flow, switch theme,
// drag an element and a flow label and watch the DSL follow. It serves the
// committed playground/ build locally, so the GIF shows what Vercel deploys.
// See scripts/demo-gif/README.md.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadChromium } from './lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'documentation', 'assets', 'playground-demo.gif');
const PORT = 8766;
// Where the identity provider is dropped, relative to the auth middleware.
const DRAG_IDP = { dx: 185, dy: -15 };
const W = 1440, H = 600;

const server = spawn('python3', ['-m', 'http.server', String(PORT), '-d', join(root, 'playground')], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const videoDir = mkdtempSync(join(tmpdir(), 'cairn-pg-'));
const chromium = await loadChromium();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: videoDir, size: { width: W, height: H } } });
// A wider preview than the default split, and a visible cursor: headless
// Chromium records no pointer, so draw one that tracks mouse events.
await context.addInitScript(() => {
  try { localStorage.setItem('cairn:split', '38%'); } catch {}
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l14 9-6.5 1.2L14 19l-2.6 1.2-3.3-6.8L3 18z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: 99999, pointerEvents: 'none', transform: 'translate(-3px,-2px)', transition: 'none' });
    document.body.appendChild(c);
    const move = e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; };
    addEventListener('pointermove', move, true);
    addEventListener('pointerdown', move, true);
  });
});
const page = await context.newPage();
const pause = ms => page.waitForTimeout(ms);
let mouse = { x: W / 2, y: H / 2 };
async function moveTo(x, y, steps = 25) { await page.mouse.move(x, y, { steps }); mouse = { x, y }; }
async function centerOf(locator) { const b = await locator.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
async function moveToEl(locator) { const c = await centerOf(locator); await moveTo(c.x, c.y); }
async function drag(from, to) {
  await moveTo(from.x, from.y);
  await pause(250);
  await page.mouse.down();
  await moveTo(to.x, to.y, 35);
  await pause(150);
  await page.mouse.up();
}
// Puts the caret at the end of the line that contains `text`, scrolled into
// view; with `select`, highlights that line's `{ … }` block instead — the hint
// a drag just wrote.
async function caretAfterLine(text, select = false) {
  await page.evaluate(([t, select]) => {
    const ed = document.getElementById('editor');
    const i = ed.value.indexOf(t);
    const end = ed.value.indexOf('\n', i);
    const brace = ed.value.lastIndexOf('{', end);
    ed.focus();
    ed.setSelectionRange(select && brace > i ? brace : end, end);
    const line = ed.value.slice(0, end).split('\n').length;
    ed.scrollTop = Math.max(0, line * 20.2 - ed.clientHeight / 2);
  }, [text, select]);
}
const svgText = label => page.locator('#preview svg text', { hasText: label }).first();

await page.goto(`http://localhost:${PORT}/index.html`);
await page.waitForSelector('#preview svg');
await page.mouse.move(mouse.x, mouse.y);
await pause(1200);

// 1. Start from a template
await moveToEl(page.locator('#templates'));
await pause(300);
await page.selectOption('#templates', 'application');
await pause(1800);

// 2. Type a new element and a flow — the preview re-renders as you type
await moveTo(300, 420);
await caretAfterLine('external PARTNER');
await pause(400);
await page.keyboard.type('\nexternal PSP "Payment provider"', { delay: 55 });
await pause(600);
await caretAfterLine('WORKER -> PARTNER');
await page.keyboard.type('\nAPI    -> PSP "Charge card" (HTTPS, JSON)', { delay: 55 });
await pause(1400);
await moveToEl(page.locator('#zoom-fit'));
await page.click('#zoom-fit');
await pause(1200);

// 3. Preview it in another theme
await moveToEl(page.locator('#theme'));
await pause(300);
await page.selectOption('#theme', 'nord');
await pause(1600);

// 4. Drag an element — the layout is automatic, but here the identity
// provider landed at the far right, stretching its (OIDC, JWT) flow across
// the whole diagram. Pull it in next to the auth middleware; the DSL gains an
// `offset:` hint, so the CLI renders the same thing.
const idp = await centerOf(svgText('Identity provider'));
const auth = await centerOf(svgText('Auth middleware'));
await drag(idp, { x: auth.x + DRAG_IDP.dx, y: idp.y + DRAG_IDP.dy });
await pause(400);
await caretAfterLine('idp IDP', true);
await pause(2400);

// 5. Rest on the result
await moveTo(W * 0.7, H * 0.8);
await pause(2400);

await context.close();
await browser.close();
server.kill();

const webm = join(videoDir, readdirSync(videoDir).find(f => f.endsWith('.webm')));
const palette = join(videoDir, 'palette.png');
const vf = 'fps=12,scale=1200:-1:flags=lanczos';
// Trim the first half-second: it is the blank page before navigation.
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0.6', '-i', webm, '-vf', `${vf},palettegen=stats_mode=diff:max_colors=128`, palette]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0.6', '-i', webm, '-i', palette, '-lavfi',
  `${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, '-loop', '0', out]);
rmSync(videoDir, { recursive: true, force: true });
console.log(`✓ ${out}`);
