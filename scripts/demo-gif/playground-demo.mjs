// Records documentation/assets/playground-demo.gif — the playground driven by a
// scripted mouse and keyboard through one small story: start from a template,
// add a payment provider, fix the typo the diagnostics catch, then tidy what
// the automatic layout got wrong with each of the playground's tools, and
// export. Every action fixes something visible; a caption says what.
//
// It serves the committed playground/ build locally, so the GIF shows what
// Vercel deploys. Grab points (a flow's end, one run of a route) are found the
// way a person finds them — by hovering until the playground's cursor changes —
// so the script follows the layout instead of hard-coding pixels.
// See scripts/demo-gif/README.md. `STEPS=<dir>` also saves a PNG per step.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadChromium, demoOverlay, setCaption, videoToGif } from './lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'documentation', 'assets', 'playground-demo.gif');
const PORT = 8766;
const W = 1280, H = 640;
const stepsDir = process.env.STEPS;
if (stepsDir) mkdirSync(stepsDir, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', String(PORT), '-d', join(root, 'playground')], { stdio: 'ignore' });
// Stopped however the script ends — a failed step would otherwise leave it
// holding the port for the next run.
process.on('exit', () => { try { server.kill(); } catch {} });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(1));
await new Promise(r => setTimeout(r, 800));

const videoDir = mkdtempSync(join(tmpdir(), 'cairn-pg-'));
const chromium = await loadChromium();
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: videoDir, size: { width: W, height: H } },
  permissions: ['clipboard-read', 'clipboard-write'],
});
await context.addInitScript(() => { try { localStorage.removeItem('cairn:split'); } catch {} });
await context.addInitScript(demoOverlay);
const page = await context.newPage();
const pause = ms => page.waitForTimeout(ms);
let stepNo = 0;
async function step(name) {
  if (stepsDir) await page.screenshot({ path: join(stepsDir, `${String(++stepNo).padStart(2, '0')}-${name}.png`) });
}
const caption = html => setCaption(page, html);

async function moveTo(x, y, steps = 22) { await page.mouse.move(x, y, { steps }); }
async function boxOf(locator) { return locator.boundingBox(); }
const mid = b => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
async function moveToEl(locator) { const c = mid(await boxOf(locator)); await moveTo(c.x, c.y); }
async function clickEl(locator) { await moveToEl(locator); await pause(250); await locator.click(); }
async function drag(from, to, steps = 32) {
  await moveTo(from.x, from.y);
  await pause(300);
  await page.mouse.down();
  await moveTo(to.x, to.y, steps);
  await pause(250);
  await page.mouse.up();
}
const svgText = label => page.locator('#preview svg text', { hasText: label }).first();
async function settle() { await pause(350); await page.waitForFunction(() => !document.getElementById('stat').textContent.includes('…')); }
// Clicks fit, pausing on the button first so the click — and the zoom readout
// changing next to it — registers before the drawing jumps.
async function fit() { await moveToEl(page.locator('#zoom-fit')); await pause(600); await page.locator('#zoom-fit').click(); await pause(700); }

// Hovers each point until the preview wears `cursor` — what the playground
// shows over a flow's end (`grab`) or one run of a route (`slide-x`/`slide-y`).
// Silent: the pointer is moved without steps, so the scan never shows on
// screen; the visible pointer travels there afterwards.
async function findByCursor(points, cursors) {
  for (const p of points) {
    await page.mouse.move(p.x, p.y);
    const hit = await page.evaluate(cs => cs.some(c => document.getElementById('preview').classList.contains(c)), cursors);
    if (hit) return p;
  }
  throw new Error(`nothing under the pointer wears ${cursors}`);
}
const range = (from, to, step) => { const r = []; for (let v = from; v <= to; v += step) r.push(v); return r; };

// Selects `text` in the editor (or, with `block`, the `{ … }` on its line) and
// scrolls it into view — the highlight shows what a drag just wrote.
async function highlight(text, { block = false } = {}) {
  await page.evaluate(([t, block]) => {
    const ed = document.getElementById('editor');
    const i = ed.value.indexOf(t);
    if (i < 0) return;
    const end = ed.value.indexOf('\n', i);
    const brace = ed.value.lastIndexOf('{', end);
    const [from, to] = block ? [brace > i ? brace : end, end] : [i, i + t.length];
    ed.focus();
    ed.setSelectionRange(from, to);
    const line = ed.value.slice(0, from).split('\n').length;
    ed.scrollTop = Math.max(0, line * 20.2 - ed.clientHeight / 2);
  }, [text, block]);
}
async function caretAfter(text) {
  await page.evaluate(t => {
    const ed = document.getElementById('editor');
    const i = ed.value.indexOf(t);
    const end = ed.value.indexOf('\n', i);
    ed.focus();
    ed.setSelectionRange(end, end);
    const line = ed.value.slice(0, end).split('\n').length;
    ed.scrollTop = Math.max(0, line * 20.2 - ed.clientHeight / 2);
  }, text);
}

await page.goto(`http://localhost:${PORT}/index.html`);
await page.waitForSelector('#preview svg');
await page.mouse.move(W / 2, H / 2);
await pause(800);

// 1. A template per view
await caption('Start from a template — one per view: <b>logical</b>, <b>application</b>, <b>infrastructure</b>');
await moveToEl(page.locator('#templates'));
await pause(500);
await page.selectOption('#templates', 'application');
await settle();
await pause(1500);
await step('template');

// 2. Type — and let the diagnostics catch the typo
await caption('Edit the source — the preview re-renders as you type');
await moveTo(200, 430);
await caretAfter('external PARTNER');
await page.keyboard.type('\nexternal PSP "Payment provider"', { delay: 45 });
await caretAfter('WORKER -> PARTNER');
await page.keyboard.type('\nAPI    -> PSPP "Charge the card and capture the payment" (HTTPS, JSON)', { delay: 45 });
await settle();
await caption('A typo — diagnostics say where, and suggest the fix. Click one to jump to its line');
await pause(1600);
await step('typo');
await clickEl(page.locator('#diags .diag').first());
await pause(500);
await highlight('PSPP');
await pause(500);
await page.keyboard.type('PSP', { delay: 90 });
await settle();
await caption(null);
await pause(900);
await step('fixed');

// 3. The diagram grew wider than the pane — make room, then fit it
await caption('The diagram now overflows the pane — drag the splitter for more room…');
// The splitter's right half sits under the preview (negative margin): grab
// its left edge.
const splitBox = await boxOf(page.locator('#splitter'));
const split = { x: splitBox.x + 2, y: splitBox.y + splitBox.height / 2 };
await drag(split, { x: W * 0.33, y: split.y }, 26);
await caption('…then <b>fit</b> it to the pane');
await fit();
await pause(1400);
await step('split');

// 4. Theme preview
await caption('Preview it in any built-in theme');
await moveToEl(page.locator('#theme'));
await pause(400);
await page.selectOption('#theme', 'nord');
await settle();
await pause(1400);
await step('theme');

// 5. The long label hugs the system frame — wrap it
await caption('That long flow label runs along the frame — hover it and click <b>↵</b> to wrap it');
const longLabel = mid(await boxOf(svgText('Charge the card and capture')));
await moveTo(longLabel.x, longLabel.y);
await pause(700);
await clickEl(page.locator('#wrap-icon'));
await settle();
await highlight('flow-label-wrap');
await pause(1600);
await step('wrap');

// 6. The flow comes up into Payment provider from below — re-attach it
await caption('The flow enters <i>Payment provider</i> from below — drag its arrow to the left side');
const psp = await boxOf(svgText('Payment provider'));
// The text's box is narrower than the element's; scan the band under it.
const below = range(psp.y + psp.height + 2, psp.y + psp.height + 16, 2)
  .flatMap(y => range(psp.x - 20, psp.x + psp.width + 20, 3).map(x => ({ x, y })));
const tip = await findByCursor(below, ['grab']);
await moveTo(tip.x - 80, tip.y + 30, 1);
await drag(tip, { x: psp.x - 30, y: psp.y + psp.height / 2 });
await settle();
await highlight('PSP.left');
await pause(1800);
await step('reattach');

// 7. Identity provider landed far right — pull it in
await caption('<i>Identity provider</i> landed far right, stretching its flow across the diagram — drag it in');
const idp = mid(await boxOf(svgText('Identity provider')));
const auth = await boxOf(svgText('Auth middleware'));
const sys = await boxOf(svgText('My system'));
await drag(idp, { x: auth.x + auth.width + 150, y: sys.y - 30 });
await settle();
await highlight('idp IDP', { block: true });
await pause(1800);
await step('element');

// 8. Zoom in where the detail is — ctrl+wheel (or a pinch) zooms on the pointer
await caption('Zoom in on the detail — ctrl + wheel, or pinch, zooms where the pointer is');
// Anchored on the right end of the drawing, so the zoom grows it leftwards
// and Payment provider stays in view.
const zoomBox = await boxOf(svgText('Payment provider'));
// Leave the preview first: the hover outline from the last drag would
// otherwise stay painted where the element was before the zoom.
await moveTo(W * 0.2, H * 0.5, 12);
await moveTo(zoomBox.x + zoomBox.width + 6, zoomBox.y + zoomBox.height / 2);
await page.keyboard.down('Control');
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -60); await pause(90); }
await page.keyboard.up('Control');
await pause(1200);
await step('zoom');

// 9. Slide the last run so the arrow meets the box square on
await caption('Slide one run of a route — here, so the arrow meets <i>Payment provider</i> at mid-height');
const psp2 = await boxOf(svgText('Payment provider'));
const runPoints = range(psp2.y - 30, psp2.y + psp2.height + 30, 2).map(y => ({ x: psp2.x - 40, y }));
const run = await findByCursor(runPoints, ['slide-y']);
await moveTo(run.x - 60, run.y + 40, 1);
await drag(run, { x: run.x, y: psp2.y + psp2.height / 2 + 1 });
await settle();
await highlight('segment-offset');
await pause(1800);
await step('segment');

// 10. Its label sits inside My system, though the flow leaves it — move it out
await caption('Its label sits inside <i>My system</i>, but the flow leaves it — drag the label out beside the arrow');
// The label is three lines (two wrapped, then the protocol); place the whole
// block just above the arrow and left of the box, clear of both.
const lines = [await boxOf(svgText('Charge the card')), await boxOf(svgText('capture the payment')), await boxOf(svgText('(HTTPS, JSON)'))];
const block = {
  right: Math.max(...lines.map(l => l.x + l.width)),
  bottom: Math.max(...lines.map(l => l.y + l.height)),
};
const psp3 = await boxOf(svgText('Payment provider'));
const arrowY = psp3.y + psp3.height / 2;
const grab = mid(lines[0]);
await drag(grab, { x: grab.x + (psp3.x - 26) - block.right, y: grab.y + (arrowY - 4) - block.bottom });
await settle();
await highlight('label-offset');
await pause(1800);
await step('label');

// 11. Back to the whole picture, then share and export
await caption('Done with the detail — <b>fit</b> brings the whole diagram back');
await fit();
await pause(1800);
await caption('Every drag is text in the source — share it as a link…');
await clickEl(page.locator('#share'));
await pause(1400);
await caption('…download the SVG, or the flow matrix as CSV, Markdown or SVG');
const [svgFile] = await Promise.all([page.waitForEvent('download'), clickEl(page.locator('#download'))]);
await caption(`…download the SVG <span style="color:#3fb950">✓ ${svgFile.suggestedFilename()}</span>, or the flow matrix as CSV, Markdown or SVG`);
await pause(900);
await moveToEl(page.locator('#matrix-format'));
await page.selectOption('#matrix-format', 'md');
await pause(400);
const [matrixFile] = await Promise.all([page.waitForEvent('download'), clickEl(page.locator('#download-matrix'))]);
await caption(`…download the SVG <span style="color:#3fb950">✓ ${svgFile.suggestedFilename()}</span>, or the flow matrix <span style="color:#3fb950">✓ ${matrixFile.suggestedFilename()}</span>`);
await pause(1600);
await step('export');

// 12. Rest on the result
await caption(null);
await moveTo(W * 0.62, H * 0.82);
await pause(2600);
await step('final');

await context.close();
await browser.close();
server.kill();

const webm = join(videoDir, readdirSync(videoDir).find(f => f.endsWith('.webm')));
// Trim the first half-second: it is the blank page before navigation.
videoToGif(webm, out, { trim: 0.6 });
rmSync(videoDir, { recursive: true, force: true });
console.log(`✓ ${out}`);
