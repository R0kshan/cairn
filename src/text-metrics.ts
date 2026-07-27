/**
 * Platform-independent text measurement. Estimates label widths/heights purely
 * arithmetically (`length × fontSize × CHAR_WIDTH`) instead of querying system
 * fonts — this is what keeps rendered output byte-identical across OSes. Also
 * provides `wrapText`, node sizing, and flow-label box math. Do not introduce
 * real font metrics here; determinism depends on it (see CLAUDE.md).
 */

export const DEFAULT_FONT_SIZE_EDGE = 11.5,
  DEFAULT_FONT_SIZE_NODE = 12.5,
  DEFAULT_FONT_SIZE_CONTAINER = 13;
export const FONT_SIZE_BASE = 12.5;
export const CHAR_WIDTH = 0.56;

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

export const measure = (text: string, fontSize: number) => {
  const lines = text.split("\n");
  return {
    lines,
    width: Math.ceil(Math.max(...lines.map((line) => line.length)) * fontSize * CHAR_WIDTH) + 6,
    height: lines.length * (fontSize + 3) + 4,
  };
};

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

export const CHIP_HEIGHT = 19;
export const chipW = (name: string, scale = 1) =>
  Math.ceil(name.length * 9.5 * scale * CHAR_WIDTH) + Math.round(16 * scale);
export const techText = (tech?: { protocol?: string; format?: string }) =>
  tech?.protocol ? `(${tech.protocol}${tech.format ? ", " + tech.format : ""})` : "";

export const flowLabelBox = (
  text: string,
  chipNames: string[],
  fontSize: number,
  tech?: string,
  scale = 1,
) => {
  const measured = text ? measure(text, fontSize) : { width: 0, height: 0 };
  const chips = chipNames.reduce((sum, name) => sum + chipW(name, scale) + 4, -4);
  const techW = tech ? Math.ceil(tech.length * 9 * scale * CHAR_WIDTH) + 6 : 0;
  return {
    width: Math.max(measured.width, chips > 0 ? chips + 4 : 0, techW),
    height:
      measured.height + (tech ? 12 * scale : 0) + (chipNames.length ? CHIP_HEIGHT * scale : 0),
  };
};

export const nodeSize = (
  kind: string,
  label: string,
  fontSize: number = DEFAULT_FONT_SIZE_NODE,
) => {
  const isActor = kind === "actor";
  const measured = measure(label, isActor ? fontSize - 1.5 : fontSize);
  return {
    width: isActor ? Math.max(64, measured.width + 8) : Math.max(140, measured.width + 16),
    height: isActor ? 56 + (label.split("\n").length - 1) * 11 : Math.max(46, measured.height + 18),
  };
};
