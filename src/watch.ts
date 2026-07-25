/**
 * `cairn watch`: rebuild the SVG on every save.
 *
 * Watches the source file and re-runs parse → validate → layout → render on
 * each change, keeping the output SVG fresh for an editor's auto-refresh
 * preview. On errors the SVG is replaced with an error panel (never a stale
 * diagram), so the preview always reflects the file's current state.
 */

import { watch as fsWatch, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { parse } from './parser.ts';
import { validate } from './validator.ts';
import { renderHuman } from './diagnostics.ts';
import { layout } from './scene-layout.ts';
import { render } from './svg-render.ts';
import { views, type Diagnostic } from './model.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function errorPanelSvg(file: string, diags: Diagnostic[]): string {
  const errors = diags.filter(d => d.severity === 'error').slice(0, 10);
  const more = diags.filter(d => d.severity === 'error').length - errors.length;
  const H = 96 + errors.length * 44 + (more > 0 ? 24 : 0);
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 ${H}" font-family="ui-monospace,Menlo,Consolas,monospace">
<rect width="860" height="${H}" fill="#fff5f5"/>
<rect x="6" y="6" width="848" height="${H - 12}" rx="8" fill="none" stroke="#c53030" stroke-width="2"/>
<text x="28" y="40" font-size="17" font-weight="bold" fill="#c53030">✗ ${errors.length}${more > 0 ? '+' : ''} error${errors.length + more > 1 ? 's' : ''} — ${esc(basename(file))}</text>
<text x="28" y="62" font-size="11" fill="#7a5a5a">the diagram will refresh as soon as the file compiles again</text>\n`;
  errors.forEach((d, i) => {
    const y = 96 + i * 44;
    out += `<text x="28" y="${y}" font-size="12.5" fill="#c53030" font-weight="bold">${esc(d.code)}</text>
<text x="92" y="${y}" font-size="12.5" fill="#333">line ${d.span.line}: ${esc(d.message)}</text>\n`;
    if (d.help) out += `<text x="92" y="${y + 17}" font-size="11" fill="#666">help: ${esc(d.help.length > 90 ? d.help.slice(0, 90) + '…' : d.help)}</text>\n`;
  });
  if (more > 0) out += `<text x="28" y="${H - 20}" font-size="11" fill="#7a5a5a">… and ${more} more (see terminal)</text>\n`;
  return out + '</svg>\n';
}

export function watchCommand(file: string, outFile: string) {
  if (!existsSync(file)) { console.error(`error: file not found \`${file}\``); process.exit(2); }

  let building = false, dirty = false, runs = 0;

  const rebuild = async () => {
    if (building) { dirty = true; return; }
    building = true;
    runs++;
    const src = readFileSync(file, 'utf8');
    const { model, diags } = parse(src);
    diags.push(...validate(model));
    const errors = diags.filter(d => d.severity === 'error');
    const stamp = new Date().toLocaleTimeString();

    console.clear();
    console.log(`cairn watch — ${file} → ${outFile}   (build #${runs}, ${stamp}, Ctrl+C to quit)`);
    console.log(`watching this file only — saves to other files are ignored\n`);

    if (errors.length) {
      writeFileSync(outFile, errorPanelSvg(file, diags));
      console.log(renderHuman(file, src, diags, process.stdout.isTTY ?? false));
      console.log(`\n✗ ${outFile} shows an error panel until the file compiles`);
    } else {
      try {
        const view = views[model.type!];
        const scene = await layout(model, view);
        const { svg, overlapsAfter } = render(model, view, scene);
        writeFileSync(outFile, svg);
        if (diags.length) console.log(renderHuman(file, src, diags, process.stdout.isTTY ?? false) + '\n');
        console.log(`✓ ${outFile} (${scene.width}×${scene.height}, layout ${scene.layoutMs} ms, label overlaps: ${overlapsAfter})`);
      } catch (e: any) {
        writeFileSync(outFile, errorPanelSvg(file, [{ code: 'E0000', severity: 'error', message: e.message, span: { line: 0, col: 0, len: 0 }, help: 'check the terminal for details' }]));
        console.error('layout/render error:', e.message);
        console.log(`\n✗ ${outFile} shows an error panel until the file compiles`);
      }
    }
    building = false;
    if (dirty) { dirty = false; setTimeout(rebuild, 30); }
  };

  // watch the parent dir: editors often save via rename-replace, which breaks
  // a direct file watcher
  let timer: ReturnType<typeof setTimeout> | null = null;
  fsWatch(dirname(file) || '.', (_evt, fname) => {
    if (fname && fname !== basename(file)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(rebuild, 120);
  });

  rebuild();
}
