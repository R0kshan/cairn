/**
 * Validates and merges custom theme specs — the palette an embedder passes to
 * `compile({ theme })`, and the JSON behind the CLI's `--theme <file.json>`.
 *
 * A custom theme **extends a built-in and overrides what it names**. Authoring
 * a palette outright means some fifty colours, nearly all of which a user would
 * copy unchanged from an existing theme; starting from `dark` and changing four
 * is the case worth making easy.
 *
 * Deliberately free of Node imports. The npm package's `.` export is bundled
 * from the browser entry (`playground.ts` → `dist/cairn.mjs`), so everything
 * reachable from `api.ts` has to run without a filesystem. Reading a file is
 * `theme-file.ts`'s job, and only the CLI imports that.
 */
import { THEME_SPECS, type ThemeSpec } from "./themes.ts";

/** The base a theme extends when it does not say. */
const DEFAULT_BASE = "light";

/**
 * What a caller writes: a base to extend plus the colours they want changed.
 *
 * Deliberately not `ThemeSpec`, which is the *complete* palette the renderer
 * needs. Every field here is optional and inherited from `extends` when absent,
 * which is what makes a two-key theme possible.
 */
export interface ThemeOverrides {
  /** A built-in theme name to inherit from. Defaults to `light`. */
  extends?: string;
  /** Whether the palette sits on a dark ground. Selects the flow colour set. */
  dark?: boolean;
  /** Canvas and chrome colours. */
  pal?: Partial<ThemeSpec["pal"]>;
  /** Per-kind fills and strokes. */
  accentColors?: Record<string, string>;
  /** Security-view sensitivity levels, each a `[fill, stroke]` pair. */
  lv?: Record<string, [string, string]>;
}

/** Raised for a spec that cannot be turned into a theme, naming the key at fault. */
export class ThemeSpecError extends Error {}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Overlays `patch` onto `base` one level deep, which is exactly as deep as a
 * `ThemeSpec` goes: `pal`, `accentColors` and `lv` hold flat maps of colours.
 * Deeper generic merging would be able to half-replace a `[fill, stroke]` pair
 * and produce a colour the author never wrote.
 */
const merge = (base: ThemeSpec, patch: Record<string, unknown>): ThemeSpec => {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "extends") continue;
    const current = merged[key];
    merged[key] = isObject(value) && isObject(current) ? { ...current, ...value } : value;
  }
  return merged as unknown as ThemeSpec;
};

/**
 * Every colour a spec sets, as `path -> value`, so a malformed one is reported
 * by the key that is wrong rather than by a whole-object mismatch.
 */
function* colourEntries(patch: Record<string, unknown>): Generator<[string, unknown]> {
  for (const [section, value] of Object.entries(patch)) {
    if (section === "extends" || section === "dark") continue;
    if (!isObject(value)) {
      yield [section, value];
      continue;
    }
    for (const [key, inner] of Object.entries(value)) yield [`${section}.${key}`, inner];
  }
}

/**
 * A colour cairn will put in an SVG attribute unaltered: hex, `rgb()`/`hsl()`,
 * or a bare CSS keyword. Deliberately permissive about keywords — there is no
 * list here, so an unrecognised lowercase word passes as one. The renderer
 * escapes attributes, so nothing here is a security boundary; the check exists
 * to fail a structural typo at load time, naming the key, instead of emitting a
 * diagram that quietly renders the wrong colour.
 */
const COLOUR = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([0-9.,%\s/-]+\)|[a-z]+)$/i;

/**
 * Validates `input` and returns it merged over the built-in it extends.
 *
 * Every failure throws rather than warning. Unlike a missing logo, a theme the
 * caller asked for by name cannot be skipped and still give them what they
 * asked for — rendering the default palette instead would look like success.
 */
export function resolveThemeSpec(input: ThemeOverrides | unknown): ThemeSpec {
  if (!isObject(input)) throw new ThemeSpecError("a theme must be an object");

  const base = input.extends ?? DEFAULT_BASE;
  if (typeof base !== "string") throw new ThemeSpecError("`extends` must be a theme name");
  const baseSpec = THEME_SPECS[base];
  if (!baseSpec) {
    throw new ThemeSpecError(
      `extends unknown theme \`${base}\` — pick one of: ${Object.keys(THEME_SPECS).join(", ")}`,
    );
  }

  if ("dark" in input && typeof input.dark !== "boolean") {
    throw new ThemeSpecError("`dark` must be true or false");
  }

  for (const [key, value] of colourEntries(input)) {
    // `pal.chip` and `pal.badge`, and every `lv` entry, are tuples of colours.
    if (!Array.isArray(value) && typeof value !== "string") {
      throw new ThemeSpecError(`\`${key}\` must be a colour, got ${typeof value}`);
    }
    for (const colour of Array.isArray(value) ? value : [value]) {
      if (typeof colour !== "string" || !COLOUR.test(colour)) {
        throw new ThemeSpecError(`\`${key}\`: \`${String(colour)}\` is not a colour`);
      }
    }
  }

  return merge(baseSpec, input);
}
