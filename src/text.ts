// Shared text metrics (approx, 1 char ~ 0.56 * fontSize for sans).

export const FS_EDGE = 10.5, FS_NODE = 11.5, FS_CONT = 12;
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
export const chipW = (name: string) => Math.ceil(name.length * 9.5 * 0.56) + 16;
export const techText = (t?: { protocol?: string; format?: string }) =>
  t?.protocol ? `(${t.protocol}${t.format ? ', ' + t.format : ''})` : '';

export const flowLabelBox = (text: string, chipNames: string[], fs: number, tech?: string) => {
  const m = text ? measure(text, fs) : { width: 0, height: 0 };
  const chips = chipNames.reduce((s, n) => s + chipW(n) + 4, -4);
  const techW = tech ? Math.ceil(tech.length * 9 * 0.56) + 6 : 0;
  return {
    width: Math.max(m.width, chips > 0 ? chips + 4 : 0, techW),
    height: m.height + (tech ? 12 : 0) + (chipNames.length ? CHIP_H : 0),
  };
};

export const nodeSize = (kind: string, label: string) => {
  const isActor = kind === 'actor';
  const m = measure(label, isActor ? FS_NODE - 1.5 : FS_NODE);
  return {
    w: isActor ? Math.max(64, m.width + 8) : Math.max(140, m.width + 16),
    h: isActor ? 56 + (label.split('\n').length - 1) * 11 : Math.max(46, m.height + 18),
  };
};
