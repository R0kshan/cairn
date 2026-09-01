/**
 * Reads the files behind `logo: "<path>"` and inlines them, so the renderer
 * never touches a filesystem it may not have (the playground has none).
 *
 * Inlined rather than linked on purpose. A `data:` URI keeps the SVG one
 * self-contained file that renders offline and cannot change under the author's
 * feet, and browsers treat an `<image>` with a `data:` source as a restricted
 * document — scripts inside a supplied SVG do not run and its own external
 * references are not fetched — so a hostile logo file cannot execute or phone
 * home through the diagram that embeds it.
 */
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { dirname, resolve, extname } from "node:path";
import type { Model, Element } from "./models/ast.ts";
import type { Diagnostic } from "./models/diagnostic.ts";
import { subtreeElements } from "./element-tree.ts";

/**
 * What a logo file may be. SVG covers brand marks properly at any zoom; the
 * raster formats are here because that is often all a vendor ships. Anything
 * else is refused rather than guessed at, since the MIME type is what tells the
 * renderer how to decode the bytes.
 */
const MIME_BY_EXT: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/**
 * A logo is a corner mark a few pixels wide, and it is inlined into every copy
 * of the diagram. Anything approaching this is a photograph pasted in by
 * mistake, and refusing it early beats emitting a megabyte of base64.
 */
const MAX_BYTES = 256 * 1024;

export interface ResolvedLogos {
  /** Element id → `data:` URI, ready for the renderer. */
  logos: Map<string, string>;
  diagnostics: Diagnostic[];
}

/**
 * Resolves every file-sourced logo in `model`, relative to the diagram that
 * declared it — the author writes paths as they see them from the `.cairn`
 * file, not from wherever the CLI happens to run.
 *
 * A logo that cannot be read is a warning, not an error: the diagram is still
 * a correct diagram, and failing the build over a missing decoration would be
 * out of proportion. It renders without the mark and says so.
 */
export function resolveLogoFiles(model: Model, sourceFile: string): ResolvedLogos {
  const logos = new Map<string, string>();
  const diagnostics: Diagnostic[] = [];
  const base = dirname(resolve(sourceFile));

  for (const element of model.elements.flatMap((root) => subtreeElements(root))) {
    const logo: Element["logo"] = element.logo;
    if (logo?.source !== "file") continue;

    const warn = (message: string, help: string) =>
      diagnostics.push({
        code: "W0580",
        severity: "warning",
        message,
        span: logo.span,
        help,
      });

    const mime = MIME_BY_EXT[extname(logo.value).toLowerCase()];
    if (!mime) {
      warn(
        `unsupported logo file type \`${extname(logo.value) || logo.value}\``,
        `use one of: ${Object.keys(MIME_BY_EXT).join(", ")}`,
      );
      continue;
    }

    // Resolved against the diagram's own directory. A path that climbs out of
    // it is honoured — an author may well keep one shared logo folder beside
    // several diagrams — but it is the author's own path either way; nothing
    // here follows a path that came from anywhere but the source file.
    const path = resolve(base, logo.value);
    let bytes: Buffer;
    try {
      // Sized and read through one descriptor, not twice through the name: a
      // path checked and then re-opened is a different file if anything swaps
      // it in between, and the size limit below is only worth stating if the
      // bytes it guards are the bytes that were measured.
      const fd = openSync(path, "r");
      try {
        const stat = fstatSync(fd);
        // A directory, a device, or a FIFO named `.svg` all open cleanly and
        // report a size — a FIFO reports zero and then blocks the build for as
        // long as nothing writes to it. Only a regular file has bytes to inline.
        if (!stat.isFile()) {
          warn(`logo file \`${logo.value}\` is not a regular file`, "point at an image file");
          continue;
        }
        if (stat.size > MAX_BYTES) {
          warn(
            `logo file is ${Math.round(stat.size / 1024)} KB, over the ${MAX_BYTES / 1024} KB limit`,
            "a corner mark needs very little — export it smaller, or use a built-in",
          );
          continue;
        }
        // Exactly the measured bytes, from offset 0 — not `readFileSync(fd)`,
        // which reads on to EOF and so would hand back more than the limit just
        // cleared if the file grew in between (a `watch` run races every
        // re-export). Short reads mean it shrank instead; keep what arrived.
        bytes = Buffer.alloc(stat.size);
        const read = readSync(fd, bytes, 0, stat.size, 0);
        if (read < stat.size) bytes = bytes.subarray(0, read);
      } finally {
        closeSync(fd);
      }
    } catch {
      warn(`cannot read logo file \`${logo.value}\``, `looked in \`${base}\``);
      continue;
    }

    logos.set(element.id, `data:${mime};base64,${bytes.toString("base64")}`);
  }

  return { logos, diagnostics };
}
