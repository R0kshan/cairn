// Records documentation/assets/cli-demo.gif — cairn used the way it is in
// practice: the .cairn source edited in VS Code, the commands run in VS Code's
// integrated terminal, the SVG open in VS Code's image preview and kept fresh
// by `cairn watch`. It is a real VS Code (code-server) and a real shell running
// the real CLI from src/ — only the mouse and keyboard are scripted.
// See scripts/demo-gif/README.md. `STEPS=<dir>` also saves a PNG per step.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadChromium, demoOverlay, setCaption, videoToGif } from './lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'documentation', 'assets', 'cli-demo.gif');
const PORT = 8767;
const W = 1280, H = 720;
const stepsDir = process.env.STEPS;
if (stepsDir) mkdirSync(stepsDir, { recursive: true });

function findCodeServer() {
  if (process.env.CODE_SERVER) return process.env.CODE_SERVER;
  try { return execFileSync('which', ['code-server'], { encoding: 'utf-8' }).trim(); }
  catch { throw new Error('code-server not found — install its standalone release and set CODE_SERVER=/path/to/bin/code-server'); }
}

// ---- A throwaway workspace, user profile and shell ---------------------------
const work = mkdtempSync(join(tmpdir(), 'cairn-vscode-'));
const shop = join(work, 'shop');
const bin = join(work, 'bin');
const profile = join(work, 'profile');
for (const d of [shop, bin, join(profile, 'User')]) mkdirSync(d, { recursive: true });
writeFileSync(join(bin, 'cairn'), `#!/bin/sh\nexec node --experimental-strip-types ${join(root, 'src', 'cli.ts')} "$@"\n`, { mode: 0o755 });
// A short prompt, and `cairn` on the PATH as if installed.
writeFileSync(join(work, 'bashrc'), [
  `export PATH="${bin}:$PATH"`,
  `PS1='\\[\\e[34m\\]~/shop\\[\\e[0m\\] \\[\\e[32m\\]❯\\[\\e[0m\\] '`,
  'clear',
].join('\n') + '\n');
writeFileSync(join(profile, 'User', 'settings.json'), JSON.stringify({
  'workbench.colorTheme': 'Default Dark Modern',
  'workbench.startupEditor': 'none',
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
  'workbench.tips.enabled': false,
  'workbench.editor.empty.hint': 'hidden',
  'chat.disableAIFeatures': true,
  'security.workspace.trust.enabled': false,
  'telemetry.telemetryLevel': 'off',
  'extensions.ignoreRecommendations': true,
  'breadcrumbs.enabled': false,
  'editor.fontSize': 15,
  'editor.minimap.enabled': false,
  'editor.stickyScroll.enabled': false,
  'editor.hover.enabled': false,
  'editor.quickSuggestions': { other: false, comments: false, strings: false },
  'editor.wordBasedSuggestions': 'off',
  'editor.suggestOnTriggerCharacters': false,
  'editor.autoClosingQuotes': 'never',
  'editor.autoClosingBrackets': 'never',
  'editor.occurrencesHighlight': 'off',
  'terminal.integrated.fontSize': 14,
  'terminal.integrated.gpuAcceleration': 'off',
  'terminal.integrated.shellIntegration.enabled': false,
  'terminal.integrated.profiles.linux': { cairn: { path: 'bash', args: ['--rcfile', join(work, 'bashrc')] } },
  'terminal.integrated.defaultProfile.linux': 'cairn',
}, null, 2));

const codeServer = spawn(findCodeServer(), [
  '--auth', 'none', '--bind-addr', `127.0.0.1:${PORT}`,
  '--user-data-dir', profile, '--extensions-dir', join(work, 'extensions'),
  '--disable-telemetry', '--disable-update-check', '--disable-workspace-trust', shop,
], { stdio: 'ignore', detached: true });
// code-server forks; kill its whole process group, however this script ends.
const stopCodeServer = () => { try { process.kill(-codeServer.pid); } catch {} };
process.on('exit', stopCodeServer);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopCodeServer(); process.exit(1); });
for (let i = 0; ; i++) {
  try { await fetch(`http://127.0.0.1:${PORT}/healthz`); break; }
  catch { if (i > 60) throw new Error('code-server did not start'); await new Promise(r => setTimeout(r, 500)); }
}

// ---- Browser ------------------------------------------------------------------
const videoDir = join(work, 'video');
const chromium = await loadChromium();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: videoDir, size: { width: W, height: H } } });
await context.addInitScript(demoOverlay);
const page = await context.newPage();
const recordingStart = Date.now();
const pause = ms => page.waitForTimeout(ms);
let stepNo = 0;
async function step(name) {
  if (stepsDir) await page.screenshot({ path: join(stepsDir, `${String(++stepNo).padStart(2, '0')}-${name}.png`) });
}
const caption = html => setCaption(page, html);
async function moveTo(x, y, steps = 20) { await page.mouse.move(x, y, { steps }); }
const mid = b => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
async function clickEl(locator) {
  const c = mid(await locator.boundingBox());
  await moveTo(c.x, c.y);
  await pause(250);
  await page.mouse.click(c.x, c.y);
}

// The terminal is read from xterm's DOM renderer (gpuAcceleration off).
const terminalText = () => page.evaluate(() => document.querySelector('.terminal-wrapper.active .xterm-rows, .xterm-rows')?.innerText ?? '');
const atPrompt = text => /❯\s*$/.test(text.replace(/\s+$/, ' '));
async function focusTerminal() { await clickEl(page.locator('.terminal-wrapper .xterm-screen').first()); }
// Clicks a visible line of the source. `.view-lines` itself is wider than
// what is on screen, and the terminal hosts monaco widgets of its own, so aim
// at a rendered line inside the editor part.
async function focusEditor() {
  const line = await page.locator('.part.editor .view-line', { hasText: 'diagram application' }).or(
    page.locator('.part.editor .view-line', { hasText: '->' })).first().boundingBox();
  await moveTo(line.x + 40, line.y + line.height / 2);
  await pause(250);
  await page.mouse.click(line.x + 40, line.y + line.height / 2);
}
// Types a command in the terminal and waits for the prompt to come back.
async function run(cmd, { hold = 1200, wait = true } = {}) {
  await focusTerminal();
  await page.keyboard.type(cmd, { delay: 38 });
  await pause(300);
  await page.keyboard.press('Enter');
  if (wait) {
    await pause(400);
    await page.waitForFunction(() => /❯\s*$/.test((document.querySelector('.xterm-rows')?.innerText ?? '').replace(/\s+$/, ' ')), null, { timeout: 30000 });
  }
  await pause(hold);
}
async function goToLine(n) {
  await page.keyboard.press('Control+G');
  await pause(250);
  await page.keyboard.type(String(n), { delay: 80 });
  await pause(250);
  await page.keyboard.press('Enter');
  // Let the go-to-line box close, or the next Enter lands in it.
  await pause(400);
  await page.keyboard.press('End');
  await pause(200);
}
// Types into the editor; Monaco needs a real Enter for each new line.
async function typeLines(text) {
  const lines = text.split('\n');
  for (const [i, line] of lines.entries()) {
    if (i) await page.keyboard.press('Enter');
    await page.keyboard.type(line, { delay: 45 });
  }
}
async function save() { await pause(300); await page.keyboard.press('Control+S'); await pause(500); }

// ---- Setup, trimmed from the GIF ------------------------------------------------
await page.goto(`http://127.0.0.1:${PORT}/?folder=${encodeURIComponent(shop)}`);
await page.waitForSelector('.monaco-workbench', { timeout: 60000 });
await pause(3000);
// The caption sits over the title bar, clear of editor and terminal.
await page.evaluate(() => Object.assign(document.getElementById('demo-caption').style, {
  top: '4px', bottom: 'auto', right: 'auto', left: '50%', transform: 'translateX(-50%)', maxWidth: '900px', padding: '5px 14px',
}));
await page.keyboard.press('Control+Backquote');
await page.waitForFunction(() => /❯\s*$/.test((document.querySelector('.xterm-rows')?.innerText ?? '').replace(/\s+$/, ' ')), null, { timeout: 90000 });
// A taller terminal: a diagnostic plus `cairn explain` should fit unscrolled.
const panel = await page.locator('.part.panel').boundingBox();
await page.mouse.move(W * 0.6, panel.y - 1);
await page.mouse.down();
await page.mouse.move(W * 0.6, panel.y - 90, { steps: 5 });
await page.mouse.up();
await page.mouse.move(W * 0.6, H * 0.3);
await pause(800);
const trim = (Date.now() - recordingStart) / 1000;

// 1. Scaffold
await caption('<code>cairn new</code> scaffolds a typed starter file — here an application view');
await run('cairn new -A shop.cairn', { hold: 900 });
await clickEl(page.locator('.explorer-folders-view .monaco-list-row', { hasText: 'shop.cairn' }));
await pause(1600);
await step('new');

// 2. Edit: add a payment provider — with a typo
await caption('Edit the source in VS Code: add a payment provider and its flow');
await focusEditor();
await goToLine(19);
await typeLines('\nexternal PSP "Payment provider"');
await page.keyboard.press('Control+End');
await typeLines('M1   -> PSPP "Charge card" (HTTPS, JSON)');
await save();
await step('edit');

// 3. Validate — and explain
await caption('<code>cairn validate</code> catches the typo, with the line, the column and a hint');
await run('clear && cairn validate shop.cairn', { hold: 2400 });
await caption('<code>cairn explain</code> gives the rule behind any diagnostic code');
await run('cairn explain E0220', { hold: 1800 });
await step('validate');

// 4. Fix it in the editor
await caption('Fix it in the editor…');
await focusEditor();
await page.keyboard.press('Control+F');
await pause(300);
await page.keyboard.type('PSPP', { delay: 90 });
await pause(500);
await page.keyboard.press('Escape');
await page.keyboard.type('PSP', { delay: 110 });
await save();
await caption('…and validate again');
await run('clear && cairn validate shop.cairn', { hold: 1200 });
await step('fixed');

// 5. Build, and open the SVG beside the source
await caption('<code>cairn build</code> renders the SVG — and checks no label overlaps');
await run('cairn build shop.cairn --theme nord', { hold: 1000 });
// Ctrl+B and Ctrl+P from the editor: a terminal with focus would hand
// Ctrl+B to bash.
await focusEditor();
await page.keyboard.press('Control+B');   // hide the sidebar: room for the preview
await pause(300);
await page.keyboard.press('Control+P');
await pause(300);
await page.keyboard.type('shop.svg', { delay: 70 });
await pause(600);
await page.keyboard.press('Control+Enter');   // open to the side
await pause(1500);
// Give the preview the larger share — the source lines are short.
const groups = page.locator('.part.editor .editor-group-container');
const sash = page.locator('.part.editor .monaco-sash.vertical').first();
const sashBox = await sash.boundingBox();
const editorPart = await page.locator('.part.editor').boundingBox();
const sashFrom = { x: sashBox.x + sashBox.width / 2, y: editorPart.y + 200 };
await moveTo(sashFrom.x, sashFrom.y);
await pause(200);
await page.mouse.down();
await moveTo(editorPart.x + editorPart.width * 0.4, sashFrom.y, 18);
await page.mouse.up();
await pause(400);
// cairn's SVG carries a viewBox but no width, so the preview opens it at the
// browser's 300px default: pick a zoom from the status bar.
await clickEl(page.locator('.statusbar-item', { hasText: 'Whole Image' }));
await pause(500);
await page.keyboard.type('200%', { delay: 90 });
await pause(300);
await page.keyboard.press('Enter');
await pause(1600);
await step('build');

// 6. Watch: rebuild on every save, the open preview follows
await caption('<code>cairn watch</code> rebuilds on every save — the open preview follows');
await run('clear && cairn watch shop.cairn --theme nord', { wait: false, hold: 1800 });
// Three saves of a flow still being written: unfinished (error), then
// without its protocol (warning), then complete — watch reports each, and the
// preview follows.
await caption('Add a session cache and save mid-flow — the quote not closed yet…');
await focusEditor();
await goToLine(17);
await typeLines('\ndatastore CACHE "Session cache"');
await page.keyboard.press('Control+End');
await typeLines('\nM1   -> CACHE "Cache sessions');
await save();
await caption('…watch reports the error; the preview turns into an error panel, not a stale diagram');
await pause(3400);
await step('watch-error');
await caption('Close the quote, save: the diagram is back — with a warning, no protocol yet');
await focusEditor();
await page.keyboard.press('Control+End');
await page.keyboard.type('"', { delay: 120 });
await save();
await pause(3200);
await step('watch-warning');
await caption('Add the protocol, save: a clean build, and the preview is up to date');
await focusEditor();
await page.keyboard.press('Control+End');
await page.keyboard.type(' (RESP)', { delay: 70 });
await save();
await pause(2800);
await step('watch');
await focusTerminal();
await page.keyboard.press('Control+C');
await pause(600);

// 7. The flow matrix
await caption('<code>cairn matrix</code> exports the flow matrix — CSV, Markdown or SVG');
await run('clear && cairn matrix shop.cairn --format md && cat shop.flow.md', { hold: 3600 });
await step('matrix');

await caption(null);
await moveTo(W * 0.45, H * 0.3);
await pause(2200);
await step('final');

await context.close();
await browser.close();
// Stopped before the workspace is deleted: it writes logs into it until then.
stopCodeServer();
const webm = join(videoDir, readdirSync(videoDir).find(f => f.endsWith('.webm')));
videoToGif(webm, out, { trim, width: 1120 });
rmSync(work, { recursive: true, force: true });
console.log(`✓ ${out}`);
process.exit(0);
