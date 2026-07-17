// Shared text metrics (approx, 1 char ~ 0.56 * fontSize for sans).

// Default text sizes (base = node size). `style { font-size: N }` overrides the
// base; edge labels sit one point below the node size, container titles a touch
// above. Kept as the single source of truth so layout and render agree.
export const FS_EDGE = 11.5, FS_NODE = 12.5, FS_CONT = 13;
// Reference base the fixed annotation sizes (tech tails, chips, tags, legend,
// bands) are calibrated to. Annotations scale by `scale = base / REF_BASE`, so
// at the default base the output is unchanged and everything grows together.
export const REF_BASE = 12.5;
export const fontSizes = (base: number) => {
  const scale = base / REF_BASE;
  return {
    edge: base - 1, node: base, cont: base + 0.5, scale,
    tech: 9 * scale, chip: 9.5 * scale, tag: 9.5 * scale,
    band: 10 * scale, bandTitle: 11 * scale, chipH: 19 * scale,
  };
};
const CW = 0.56;

export const measure = (text: string, fs: number) => {
  const lines = text.split('\n');
  return {
    lines,
    width: Math.ceil(Math.max(...lines.map(l => l.length)) * fs * CW) + 6,
    height: lines.length * (fs + 3) + 4,
  };
};

// re-wrap a label into narrow lines (slide mode: labels drive layer-gap width)
export function wrapText(text: string, maxChars: number): string {
  const words = text.replace(/\n/g, ' ').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > maxChars) { lines.push(cur); cur = w; }
    else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  return lines.join('\n');
}

// flow label box including the business-object chip row (space reserved at
// layout time so chips can never cause overlaps)
export const CHIP_H = 19;
export const chipW = (name: string, scale = 1) => Math.ceil(name.length * 9.5 * scale * CW) + Math.round(16 * scale);
export const techText = (t?: { protocol?: string; format?: string }) =>
  t?.protocol ? `(${t.protocol}${t.format ? ', ' + t.format : ''})` : '';

export const flowLabelBox = (text: string, chipNames: string[], fs: number, tech?: string, scale = 1) => {
  const m = text ? measure(text, fs) : { width: 0, height: 0 };
  const chips = chipNames.reduce((s, n) => s + chipW(n, scale) + 4, -4);
  const techW = tech ? Math.ceil(tech.length * 9 * scale * CW) + 6 : 0;
  return {
    width: Math.max(m.width, chips > 0 ? chips + 4 : 0, techW),
    height: m.height + (tech ? 12 * scale : 0) + (chipNames.length ? CHIP_H * scale : 0),
  };
};

export const nodeSize = (kind: string, label: string, fs: number = FS_NODE) => {
  const isActor = kind === 'actor';
  const m = measure(label, isActor ? fs - 1.5 : fs);
  return {
    w: isActor ? Math.max(64, m.width + 8) : Math.max(140, m.width + 16),
    h: isActor ? 56 + (label.split('\n').length - 1) * 11 : Math.max(46, m.height + 18),
  };
};
