/**
 * Reads the JSON behind the CLI's `--theme <file.json>`.
 *
 * Only the filesystem part lives here. Validating and merging a theme is
 * `theme-spec.ts`, which an embedder reaches through `compile({ theme })` — the
 * npm package's `.` export is bundled from the browser entry, so nothing it can
 * reach may import `node:fs` (INVARIANTS §12). Same split as `logo-files.ts`.
 */
import { readFileSync } from "node:fs";
import { resolveThemeSpec, ThemeSpecError } from "./theme-spec.ts";
import type { ThemeSpec } from "./themes.ts";

/**
 * A theme read from disk. `name` is the file's basename, which becomes the
 * diagram's `style.theme` once registered — so a diagnostic names the file the
 * colours came from.
 */
export interface LoadedTheme {
  name: string;
  spec: ThemeSpec;
}

/** Raised for a file that is missing, unparseable, or not a usable theme. */
export class ThemeFileError extends Error {}

/** Reads, parses and validates the theme file at `path`, merged over its base. */
export function loadThemeFile(path: string): LoadedTheme {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new ThemeFileError(`cannot read theme file \`${path}\``);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ThemeFileError(
      `\`${path}\` is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let spec: ThemeSpec;
  try {
    spec = resolveThemeSpec(parsed);
  } catch (error) {
    // Re-thrown with the path in front: the spec layer has no idea where the
    // object came from, and "`pal.bg` is not a colour" is far less useful
    // without the file that says so.
    if (error instanceof ThemeSpecError) throw new ThemeFileError(`\`${path}\`: ${error.message}`);
    throw error;
  }

  const name = (path.split(/[\\/]/).pop() ?? path).replace(/\.json$/i, "");
  if (!name) throw new ThemeFileError(`\`${path}\` has no usable theme name`);

  return { name, spec };
}
