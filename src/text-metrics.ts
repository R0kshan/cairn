/**
 * Platform-independent text measurement. Estimates label widths/heights purely
 * arithmetically (`length × fontSize × CHAR_WIDTH`) instead of querying system
 * fonts — this is what keeps rendered output byte-identical across OSes. Also
 * provides `wrapText`, node sizing, and flow-label box math. Do not introduce
 * real font metrics here; determinism depends on it (see AGENTS.md#non-negotiable-invariants).
 */

const DEFAULT_FONT_SIZE_NODE = 12.5;
const FONT_SIZE_BASE = 12.5;

/** Character width ratio for font size calculation (deterministic across platforms). */
export const CHAR_WIDTH = 0.56;

/**
 * Horizontal room a corner glyph needs inside a node: the glyph box, its inset
 * from the node edge, and the gap before the label. Kinds the renderer draws
 * with a glyph (`View.glyphKinds`) reserve it in their measured width, so a
 * long label is centred in what is left instead of running under the glyph.
 */
export const GLYPH_GUTTER = 26;

/**
 * The same room, reserved on the *right* for a `logo:` mark. Wider than
 * `GLYPH_GUTTER` because a logo is a recognisable brand shape rather than a
 * line drawing — it has to be big enough to read at a glance. Logos sit
 * opposite the kind glyph so the two can never fight for the same corner, and
 * so a container — whose name is anchored top-left — keeps its title clear.
 */
export const LOGO_GUTTER = 30;

/** Computes scaled font sizes for different element types (nodes, edges, containers, etc.). */
export const fontSizes = (base: number) => {
  const scale = base / FONT_SIZE_BASE;
  return {
    edge: base - 1,
    node: base,
    cont: base + 0.5,
    scale,
    tech: 9 * scale,
    chip: 9.5 * scale,
    tag: 9.5 * scale,
    band: 10 * scale,
    bandTitle: 11 * scale,
    chipH: 19 * scale,
  };
};

/** Measures text dimensions (width and height) for the given font size. */
export const measure = (text: string, fontSize: number) => {
  const lines = text.split("\n");
  return {
    lines,
    width: Math.ceil(Math.max(...lines.map((line) => line.length)) * fontSize * CHAR_WIDTH) + 6,
    height: lines.length * (fontSize + 3) + 4,
  };
};

/** Wraps text to fit within the specified maximum character width per line. */
export function wrapText(text: string, maxChars: number): string {
  const words = text.replace(/\n/g, " ").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = "";
  for (const word of words) {
    if (currentLine && (currentLine + " " + word).length > maxChars) {
      lines.push(currentLine);
      currentLine = word;
    } else currentLine = currentLine ? currentLine + " " + word : word;
  }
  if (currentLine) lines.push(currentLine);
  return lines.join("\n");
}

const CHIP_HEIGHT = 19;

/** Calculates the width of a chip badge based on name length and scale. */
export const chipW = (name: string, scale = 1) =>
  Math.ceil(name.length * 9.5 * scale * CHAR_WIDTH) + Math.round(16 * scale);

/** Formats technology details (protocol and format) as display text. */
export const techText = (tech?: { protocol?: string; format?: string }) =>
  tech?.protocol ? `(${tech.protocol}${tech.format ? ", " + tech.format : ""})` : "";

/** Calculates the bounding box dimensions for a flow label including text, chips, and tech details. */
export const flowLabelBox = (opts: {
  text: string;
  chipNames: string[];
  fontSize: number;
  tech?: string;
  scale?: number;
}) => {
  const { text, chipNames, fontSize, tech, scale = 1 } = opts;
  const measured = text ? measure(text, fontSize) : { width: 0, height: 0 };
  const chips = chipNames.reduce((sum, name) => sum + chipW(name, scale) + 4, -4);
  const techW = tech ? Math.ceil(tech.length * 9 * scale * CHAR_WIDTH) + 6 : 0;
  return {
    width: Math.max(measured.width, chips > 0 ? chips + 4 : 0, techW),
    height:
      measured.height + (tech ? 12 * scale : 0) + (chipNames.length ? CHIP_HEIGHT * scale : 0),
  };
};

/**
 * Calculates node dimensions based on kind, label text, and font size.
 *
 * `gutter` is horizontal room the label must not use — `GLYPH_GUTTER` for a
 * kind the renderer draws with a corner glyph. It is added inside the minimum,
 * not after it, so a short label keeps the normal minimum width and only a
 * label long enough to reach the glyph widens the box. `actor` ignores it: an
 * actor is drawn as a figure, never with a glyph.
 */
export const nodeSize = (
  kind: string,
  label: string,
  fontSize: number = DEFAULT_FONT_SIZE_NODE,
  gutter = 0,
) => {
  const isActor = kind === "actor";
  const measured = measure(label, isActor ? fontSize - 1.5 : fontSize);
  return {
    width: isActor ? Math.max(64, measured.width + 8) : Math.max(140, measured.width + 16 + gutter),
    height: isActor ? 56 + (label.split("\n").length - 1) * 11 : Math.max(46, measured.height + 18),
  };
};
