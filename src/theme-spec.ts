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
import { isColour } from "./css-colours.ts";
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
}

/** Raised for a spec that cannot be turned into a theme, naming the key at fault. */
export class ThemeSpecError extends Error {}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Overlays `patch` onto `base` one level deep, which is exactly as deep as a
 * `ThemeSpec` goes: `pal` and `accentColors` hold flat maps of colours.
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

/** The colour sections a custom theme may override. Anything else is a typo. */
const SECTIONS: readonly string[] = ["pal", "accentColors"];

/**
 * How many colours a key holds. `pal.chip` is `[fill, stroke, text]`, `pal.badge`
 * is `[fill, stroke]`, and everything else is one colour.
 */
const arityOf = (section: string, key: string): number => {
  if (section === "pal") return key === "chip" ? 3 : key === "badge" ? 2 : 1;
  return 1;
};

/** Names what the author wrote where a colour was expected. */
const describe = (value: unknown): string =>
  Array.isArray(value) ? `an array of ${value.length}` : typeof value;

/**
 * Checks one entry against the shape `ThemeSpec` declares for it, reported by
 * its full `section.key` path rather than by a whole-object mismatch.
 *
 * The length check matters as much as the format one: `merge` replaces a tuple
 * outright, so a two-element `pal.chip` would leave the renderer reading an
 * undefined chip text colour long after the theme loaded cleanly.
 */
function checkEntry(path: string, value: unknown, arity: number): void {
  if (arity === 1) {
    if (typeof value !== "string") {
      throw new ThemeSpecError(`\`${path}\` must be a colour, got ${describe(value)}`);
    }
  } else if (!Array.isArray(value) || value.length !== arity) {
    throw new ThemeSpecError(`\`${path}\` must be ${arity} colours, got ${describe(value)}`);
  }
  for (const colour of Array.isArray(value) ? value : [value]) {
    if (typeof colour !== "string" || !isColour(colour)) {
      throw new ThemeSpecError(`\`${path}\`: \`${String(colour)}\` is not a colour`);
    }
  }
}

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
  // `THEME_SPECS[base]` alone would accept anything inherited from
  // `Object.prototype` — `toString`, `constructor`, `__proto__` — and hand the
  // merge a function or the prototype instead of a spec, producing a theme with
  // no `pal` rather than the unknown-theme error the author needs to see.
  const baseSpec = Object.hasOwn(THEME_SPECS, base) ? THEME_SPECS[base] : undefined;
  if (!baseSpec) {
    throw new ThemeSpecError(
      `extends unknown theme \`${base}\` — pick one of: ${Object.keys(THEME_SPECS).join(", ")}`,
    );
  }

  if ("dark" in input && typeof input.dark !== "boolean") {
    throw new ThemeSpecError("`dark` must be true or false");
  }

  for (const [section, value] of Object.entries(input)) {
    if (section === "extends" || section === "dark") continue;
    if (!SECTIONS.includes(section)) {
      throw new ThemeSpecError(
        `unknown section \`${section}\` — a theme overrides ${SECTIONS.join(", ")}`,
      );
    }
    // Each section is a map of colours. A bare string here merges over the
    // base's object and leaves the renderer reading `pal.bg` off a string —
    // a diagram with no colours, produced long after the theme loaded cleanly.
    if (!isObject(value)) {
      throw new ThemeSpecError(
        `\`${section}\` must be an object of colours, got ${describe(value)}`,
      );
    }
    for (const [key, colour] of Object.entries(value)) {
      checkEntry(`${section}.${key}`, colour, arityOf(section, key));
    }
  }

  return merge(baseSpec, input);
}
