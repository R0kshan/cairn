/**
 * `cairn watch`: rebuilds the SVG whenever the source file changes (debounced,
 * single-file). On success writes the fresh diagram; on failure writes an
 * `errorPanelSvg` so an editor preview shows the errors instead of going blank.
 * Serializes concurrent rebuilds via a building/dirty flag.
 */

import { watch as fsWatch, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, basename } from "node:path";
import { parse } from "./parser.ts";
import { validate } from "./validator.ts";
import { renderHuman } from "./diagnostics.ts";
import { layout, attachSideDiagnostics } from "./scene-layout.ts";
import { render } from "./svg-render.ts";
import { views } from "./views.ts";
import type { Diagnostic } from "./models/diagnostic.ts";
import { esc } from "./xml-escape.ts";
import { resolveLogoFiles } from "./logo-files.ts";

function errorPanelSvg(file: string, diagnostics: Diagnostic[]): string {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error").slice(0, 10);
  const more =
    diagnostics.filter((diagnostic) => diagnostic.severity === "error").length - errors.length;
  const panelHeight = 96 + errors.length * 44 + (more > 0 ? 24 : 0);
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 ${panelHeight}" font-family="ui-monospace,Menlo,Consolas,monospace">
<rect width="860" height="${panelHeight}" fill="#fff5f5"/>
<rect x="6" y="6" width="848" height="${panelHeight - 12}" rx="8" fill="none" stroke="#c53030" stroke-width="2"/>
<text x="28" y="40" font-size="17" font-weight="bold" fill="#c53030">\u2717 ${errors.length}${more > 0 ? "+" : ""} error${errors.length + more > 1 ? "s" : ""} — ${esc(basename(file))}</text>
<text x="28" y="62" font-size="11" fill="#7a5a5a">the diagram will refresh as soon as the file compiles again</text>\n`;
  errors.forEach((diagnostic, index) => {
    const rowY = 96 + index * 44;
    out += `<text x="28" y="${rowY}" font-size="12.5" fill="#c53030" font-weight="bold">${esc(diagnostic.code)}</text>
<text x="92" y="${rowY}" font-size="12.5" fill="#333">line ${diagnostic.span.line}: ${esc(diagnostic.message)}</text>\n`;
    if (diagnostic.help)
      out += `<text x="92" y="${rowY + 17}" font-size="11" fill="#666">help: ${esc(diagnostic.help.length > 90 ? diagnostic.help.slice(0, 90) + "\u2026" : diagnostic.help)}</text>\n`;
  });
  if (more > 0)
    out += `<text x="28" y="${panelHeight - 20}" font-size="11" fill="#7a5a5a">\u2026 and ${more} more (see terminal)</text>\n`;
  return out + "</svg>\n";
}

/** Watches a Cairn source file and rebuilds the SVG output on changes (debounced). */
export function watchCommand(file: string, outFile: string) {
  if (!existsSync(file)) {
    console.error(`error: file not found \`${file}\``);
    process.exit(2);
  }

  let building = false,
    dirty = false,
    runs = 0;

  const rebuild = async () => {
    if (building) {
      dirty = true;
      return;
    }
    building = true;
    runs++;
    const src = readFileSync(file, "utf8");
    const { model, diags } = parse(src);
    diags.push(...validate(model));
    const errors = diags.filter((diagnostic) => diagnostic.severity === "error");
    const stamp = new Date().toLocaleTimeString();

    console.clear();
    console.log(
      `cairn watch — ${file} \u2192 ${outFile}   (build #${runs}, ${stamp}, Ctrl+C to quit)`,
    );
    console.log(`watching this file only — saves to other files are ignored\n`);

    if (errors.length) {
      writeFileSync(outFile, errorPanelSvg(file, diags));
      console.log(renderHuman(file, src, diags, process.stdout.isTTY ?? false));
      console.log(`\n\u2717 ${outFile} shows an error panel until the file compiles`);
    } else {
      try {
        const view = views[model.type!];
        const scene = await layout(model, view);
        diags.push(...attachSideDiagnostics(scene, model));
        const { logos, diagnostics: logoDiagnostics } = resolveLogoFiles(model, file);
        diags.push(...logoDiagnostics);
        const { svg, overlapsAfter } = render(model, view, scene, { logos });
        writeFileSync(outFile, svg);
        if (diags.length)
          console.log(renderHuman(file, src, diags, process.stdout.isTTY ?? false) + "\n");
        console.log(
          `\u2713 ${outFile} (${scene.width}\u00d7${scene.height}, layout ${scene.layoutMs} ms, label overlaps: ${overlapsAfter})`,
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        writeFileSync(
          outFile,
          errorPanelSvg(file, [
            {
              code: "E0000",
              severity: "error",
              message,
              span: { line: 0, col: 0, len: 0 },
              help: "check the terminal for details",
            },
          ]),
        );
        console.error("layout/render error:", message);
        console.log(`\n\u2717 ${outFile} shows an error panel until the file compiles`);
      }
    }
    building = false;
    if (dirty) {
      dirty = false;
      setTimeout(rebuild, 30);
    }
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  fsWatch(dirname(file) || ".", (_event, fileName) => {
    if (fileName && fileName !== basename(file)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(rebuild, 120);
  });

  rebuild();
}
