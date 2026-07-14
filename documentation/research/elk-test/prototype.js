// Phase 0 spike: semantic model -> profile constraints -> ELK -> post-passes -> SVG
// Acceptance criteria (§1.1): (a) no label overlap incl. A<->B pairs, (b) compact area, (c) sane routing.
const fs = require('fs');
const path = require('path');
const ELK = require('elkjs');
const elk = new ELK();

// ---------- text metrics (approx, 1 char ~ 0.56 * fontSize for sans) ----------
const FS_EDGE = 10.5, FS_NODE = 11.5, FS_CONT = 12;
const CW = 0.56;
const measure = (text, fs) => {
  const lines = text.split('\n');
  return {
    lines,
    width: Math.ceil(Math.max(...lines.map(l => l.length)) * fs * CW) + 6,
    height: lines.length * (fs + 3) + 4
  };
};

// ---------- profile "logical": semantic conventions -> ELK constraints ----------
const PROFILE = {
  partitions: { 'actor-group': 0, 'system': 1, 'external-group': 2 },
  spacing: {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.partitioning.activate': 'true',
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH',
    'elk.layered.feedbackEdges': 'true',
    'elk.layered.thoroughness': '30',
    'elk.separateConnectedComponents': 'false',
    'elk.layered.spacing.nodeNodeBetweenLayers': '60',
    'elk.spacing.nodeNode': '22',
    'elk.spacing.edgeEdge': '14',
    'elk.spacing.edgeNode': '16',
    'elk.spacing.edgeLabel': '4',
    'elk.layered.edgeLabels.sideSelection': 'SMART_DOWN',
    'elk.edgeLabels.placement': 'CENTER',
    'elk.padding': '[top=34,left=14,bottom=14,right=14]'
  }
};

// ---------- build ELK graph from model ----------
const model = JSON.parse(fs.readFileSync(path.join(__dirname, 'model.json'), 'utf8'));
const kindOf = {}, labelOf = {};

function toElkNode(n) {
  kindOf[n.id] = n.kind; labelOf[n.id] = n.label;
  if (n.children) {
    return {
      id: n.id,
      layoutOptions: { 'elk.padding': '[top=34,left=14,bottom=14,right=14]' },
      labels: [{ text: n.label, ...measure(n.label, FS_CONT) }],
      children: n.children.map(toElkNode)
    };
  }
  const m = measure(n.label, FS_NODE);
  const isActor = n.kind === 'actor';
  return {
    id: n.id,
    width: Math.max(isActor ? 80 : 140, m.width + 16),
    height: isActor ? 78 : Math.max(46, m.height + 18)
  };
}

const graph = {
  id: 'root',
  layoutOptions: PROFILE.spacing,
  children: model.groups.map(g => {
    const node = toElkNode(g);
    node.layoutOptions = {
      ...node.layoutOptions,
      'elk.partitioning.partition': String(PROFILE.partitions[g.kind] ?? 1)
    };
    return node;
  }),
  edges: model.flows.map(f => ({
    id: f.id, sources: [f.from], targets: [f.to],
    labels: [{ text: f.label, ...measure(f.label, FS_EDGE) }]
  }))
};

// ---------- helpers: absolute coordinates ----------
function absolutize(layout) {
  const origins = { root: { x: 0, y: 0 } };
  const nodes = [];
  (function walk(n, ox, oy) {
    for (const c of n.children || []) {
      const ax = ox + c.x, ay = oy + c.y;
      origins[c.id] = { x: ax, y: ay };
      nodes.push({ id: c.id, x: ax, y: ay, w: c.width, h: c.height,
        container: !!(c.children && c.children.length), labels: c.labels });
      walk(c, ax, ay);
    }
  })(layout, 0, 0);
  return { origins, nodes };
}

const inter = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);

// ---------- main ----------
(async () => {
  const t0 = Date.now();
  const layout = await elk.layout(graph);
  const layoutMs = Date.now() - t0;
  const { origins, nodes } = absolutize(layout);

  // collect edges (coordinates are relative to edge.container, default root)
  const edges = [];
  (function collect(n) {
    for (const e of n.edges || []) {
      const o = origins[e.container] || { x: 0, y: 0 };
      const s = e.sections?.[0];
      const pts = s ? [s.startPoint, ...(s.bendPoints || []), s.endPoint]
        .map(p => ({ x: p.x + o.x, y: p.y + o.y })) : [];
      const labels = (e.labels || []).map(l => ({
        text: l.text, x: l.x + o.x, y: l.y + o.y, w: l.width, h: l.height
      }));
      edges.push({ id: e.id, pts, labels });
    }
    (n.children || []).forEach(collect);
  })(layout);

  // ---------- post-pass: label collision detection & resolution ----------
  const leafBoxes = nodes.filter(n => !n.container).map(n => ({ x: n.x, y: n.y, w: n.w, h: n.h }));
  const labelBoxes = edges.flatMap(e => e.labels.map(l => ({ ref: l, x: l.x, y: l.y, w: l.w, h: l.h })));

  const countOverlaps = () => {
    let c = 0;
    for (let i = 0; i < labelBoxes.length; i++) {
      for (let j = i + 1; j < labelBoxes.length; j++) if (inter(labelBoxes[i], labelBoxes[j])) c++;
      for (const nb of leafBoxes) if (inter(labelBoxes[i], nb)) c++;
    }
    return c;
  };

  const before = countOverlaps();
  // greedy vertical nudge until free
  for (const lb of labelBoxes) {
    const collides = () =>
      labelBoxes.some(o => o !== lb && inter(o, lb)) || leafBoxes.some(nb => inter(nb, lb));
    if (!collides()) continue;
    const y0 = lb.y;
    outer: for (const step of [8, 14, 20, 28, 36, 44]) {
      for (const dir of [-1, 1]) {
        lb.y = y0 + dir * step;
        if (!collides()) break outer;
      }
      lb.y = y0;
    }
    lb.ref.x = lb.x; lb.ref.y = lb.y;
  }
  const after = countOverlaps();

  // ---------- SVG render ----------
  const W = Math.ceil(layout.width), H = Math.ceil(layout.height);
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const FILL = { 'actor-group': '#eef4fb', 'system': '#f6f2ea', 'system-block': '#fdfbf6', 'external-group': '#f0eef5' };
  const STROKE = { 'actor-group': '#7a9cc4', 'system': '#b09a6d', 'system-block': '#c4b258', 'external-group': '#9187b3' };
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Helvetica,Arial,sans-serif">
<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
<path d="M0,0 L10,5 L0,10 z" fill="#444"/></marker></defs>
<rect width="${W}" height="${H}" fill="white"/>\n`;

  // containers first (paint order), then leaves
  for (const n of nodes.filter(n => n.container)) {
    const k = kindOf[n.id];
    out += `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="6" fill="${FILL[k] || '#f7f7f7'}" stroke="${STROKE[k] || '#999'}" stroke-width="1.2" ${k === 'external-group' || k === 'actor-group' ? 'stroke-dasharray="5 3"' : ''}/>\n`;
    out += `<text x="${n.x + 10}" y="${n.y + 18}" font-size="${FS_CONT}" font-weight="bold" fill="#333">${esc(labelOf[n.id])}</text>\n`;
  }
  for (const n of nodes.filter(n => !n.container)) {
    const k = kindOf[n.id];
    const lines = labelOf[n.id].split('\n');
    if (k === 'actor') {
      const cx = n.x + n.w / 2;
      out += `<circle cx="${cx}" cy="${n.y + 14}" r="9" fill="none" stroke="#456" stroke-width="1.6"/>
<path d="M ${cx - 14} ${n.y + 42} q 14 -24 28 0" fill="none" stroke="#456" stroke-width="1.6"/>\n`;
      lines.forEach((l, i) => {
        out += `<text x="${cx}" y="${n.y + 56 + i * 12}" font-size="${FS_NODE - 1.5}" text-anchor="middle" fill="#234">${esc(l)}</text>\n`;
      });
    } else {
      out += `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="4" fill="white" stroke="#667" stroke-width="1.3"/>\n`;
      const cy = n.y + n.h / 2 - ((lines.length - 1) * (FS_NODE + 2)) / 2 + 4;
      lines.forEach((l, i) => {
        out += `<text x="${n.x + n.w / 2}" y="${cy + i * (FS_NODE + 2)}" font-size="${FS_NODE}" text-anchor="middle" fill="#223">${esc(l)}</text>\n`;
      });
    }
  }
  // ---- edge crossing hops: horizontal segments arc over vertical ones ----
  const HOP_R = 5;
  const vSegs = [];
  for (const e of edges) {
    for (let i = 0; i + 1 < e.pts.length; i++) {
      const a = e.pts[i], b = e.pts[i + 1];
      if (Math.abs(a.x - b.x) < 0.5) vSegs.push({ x: a.x, y1: Math.min(a.y, b.y), y2: Math.max(a.y, b.y) });
    }
  }
  function edgePath(pts) {
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= 0.5) { // horizontal
        const dir = Math.sign(b.x - a.x);
        const lo = Math.min(a.x, b.x) + HOP_R + 1, hi = Math.max(a.x, b.x) - HOP_R - 1;
        const xs = vSegs
          .filter(v => v.x > lo && v.x < hi && a.y > v.y1 + 1 && a.y < v.y2 - 1)
          .map(v => v.x)
          .sort((p, q) => dir > 0 ? p - q : q - p);
        for (const cx of xs) {
          d += ` L ${cx - dir * HOP_R} ${a.y} A ${HOP_R} ${HOP_R} 0 0 ${dir > 0 ? 1 : 0} ${cx + dir * HOP_R} ${a.y}`;
        }
      }
      d += ` L ${b.x} ${b.y}`;
    }
    return d;
  }
  for (const e of edges) {
    if (e.pts.length) {
      out += `<path d="${edgePath(e.pts)}" fill="none" stroke="#444" stroke-width="1.3" marker-end="url(#arr)"/>\n`;
    }
    for (const l of e.labels) {
      out += `<rect x="${l.x - 2}" y="${l.y - 1}" width="${l.w + 4}" height="${l.h + 2}" fill="white" fill-opacity="0.92" rx="2"/>\n`;
      l.text.split('\n').forEach((line, i) => {
        out += `<text x="${l.x + l.w / 2}" y="${l.y + FS_EDGE + 1 + i * (FS_EDGE + 3)}" font-size="${FS_EDGE}" text-anchor="middle" fill="#333" font-style="italic">${esc(line)}</text>\n`;
      });
    }
  }
  out += '</svg>\n';
  fs.writeFileSync(path.join(__dirname, 'cairn-spike.svg'), out);

  // ---------- metrics ----------
  const leaves = nodes.filter(n => !n.container).length;
  const metrics = {
    layoutMs, width: W, height: H, area: W * H,
    leafNodes: leaves, labeledEdges: edges.length,
    areaPerLeaf: Math.round(W * H / leaves),
    labelOverlapsBefore: before, labelOverlapsAfter: after
  };
  fs.writeFileSync(path.join(__dirname, 'metrics-spike.json'), JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics, null, 2));
})();
