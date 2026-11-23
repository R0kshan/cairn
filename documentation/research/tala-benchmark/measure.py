#!/usr/bin/env python3
"""Measure the readability of rendered diagrams from their SVG, the same way
for every tool.

    python3 measure.py out/*.svg            # one line per file, then JSON
    python3 measure.py --json out/*.svg     # JSON only

Only the final SVG is read, so cairn and D2 (whatever its layout engine) are
measured by one ruler. The only tool-specific knowledge is how to read text:
D2 embeds its fonts, which are used as-is; cairn declares Helvetica/Arial,
measured with Liberation Sans or Arial, which share the same metrics.

What is measured (see README.md for the reasoning):

  text_overlaps    pairs of text lines whose boxes intersect
  text_crossed     text lines crossed by a line that isn't their own
  edge_crossings   pairs of lines that cross each other
  through_boxes    a line passing through a box that is neither its source
                   nor its target (counted per line and box)
  width, height    the canvas
  a4_min_px        smallest text height once the whole canvas is fitted to an
                   A4 landscape page (1123 x 794 px at 96 dpi), no upscaling cap
  slide_min_px     the same on a 16:9 slide (1280 x 720)

A text line "belongs" to a line when it lies within OWN_DIST px of it (flow
labels sit on or beside their line); that line is not counted as crossing it.
For D2, which groups each connection with its label, the script also reports
how often this rule agrees with D2's own grouping (owner_agreement).
"""

import base64
import io
import json
import math
import os
import re
import sys
import xml.etree.ElementTree as ET

from fontTools.ttLib import TTFont

SVG_NS = "{http://www.w3.org/2000/svg}"
SKIP = {"defs", "mask", "marker", "style", "clipPath", "symbol"}
OWN_DIST = 8.0
ENDPOINT_TOL = 5.0
MIN_BOX = (30.0, 20.0)
A4 = (1123.0, 794.0)
SLIDE = (1280.0, 720.0)
# Helvetica/Arial metrics, for cairn's text: Liberation Sans on Linux, Arial on macOS.
ARIAL_LIKE = {
    "Regular": ["/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf", "/Library/Fonts/Arial.ttf"],
    "Bold": ["/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/Library/Fonts/Arial Bold.ttf"],
    "Italic": ["/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf", "/System/Library/Fonts/Supplemental/Arial Italic.ttf", "/Library/Fonts/Arial Italic.ttf"],
    "BoldItalic": ["/usr/share/fonts/truetype/liberation/LiberationSans-BoldItalic.ttf", "/System/Library/Fonts/Supplemental/Arial Bold Italic.ttf", "/Library/Fonts/Arial Bold Italic.ttf"],
}


# ---------------------------------------------------------------- fonts


class Font:
    def __init__(self, ttfont):
        self.cmap = ttfont.getBestCmap() or {}
        self.hmtx = ttfont["hmtx"]
        self.upem = ttfont["head"].unitsPerEm
        self.fallback = self.hmtx[".notdef"][0] if ".notdef" in self.hmtx.metrics else self.upem / 2

    def width(self, text, size):
        total = 0
        for ch in text:
            glyph = self.cmap.get(ord(ch))
            total += self.hmtx[glyph][0] if glyph in self.hmtx.metrics else self.fallback
        return total * size / self.upem


_liberation = {}


def liberation(style):
    if style not in _liberation:
        for candidate in ARIAL_LIKE[style]:
            if os.path.exists(candidate):
                _liberation[style] = Font(TTFont(candidate))
                break
        else:
            sys.exit(f"no Arial-compatible font found for {style}: install Liberation Sans or Arial")
    return _liberation[style]


def d2_fonts(raw):
    """D2 embeds its regular, bold and italic fonts as base64 WOFF."""
    fonts = {}
    pattern = r"font-family: (d2-\d+-font-([a-z]+));\s*src: url\(\"data:[^;]+;base64,([A-Za-z0-9+/=]+)"
    for _family, style, data in re.findall(pattern, raw):
        fonts[style] = Font(TTFont(io.BytesIO(base64.b64decode(data))))
    return fonts


# ---------------------------------------------------------------- geometry


def num(value, default=0.0):
    if value is None:
        return default
    match = re.match(r"\s*(-?[\d.]+(?:e-?\d+)?)", value)
    return float(match.group(1)) if match else default


def path_points(d):
    """Flatten an SVG path into polylines (curves sampled, arcs as chords)."""
    tokens = re.findall(r"[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?", d)
    polys, cur, pos, start, last_ctrl, cmd, i = [], [], (0.0, 0.0), (0.0, 0.0), None, None, 0

    def take(n):
        nonlocal i
        vals = [float(t) for t in tokens[i:i + n]]
        i += n
        return vals

    def curve(p0, p1, p2, p3, steps=8):
        out = []
        for k in range(1, steps + 1):
            t = k / steps
            mt = 1 - t
            out.append((
                mt ** 3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t ** 3 * p3[0],
                mt ** 3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t ** 3 * p3[1],
            ))
        return out

    while i < len(tokens):
        if re.match(r"[A-Za-z]", tokens[i]):
            cmd = tokens[i]
            i += 1
            if cmd in "Zz":
                if cur:
                    cur.append(start)
                pos, last_ctrl = start, None
                continue
        if cmd is None:
            break
        rel = cmd.islower()
        c = cmd.upper()
        ox, oy = pos if rel else (0.0, 0.0)
        if c == "M":
            x, y = take(2)
            if cur:
                polys.append(cur)
            pos = start = (ox + x, oy + y)
            cur = [pos]
            cmd = "l" if rel else "L"
            last_ctrl = None
        elif c == "L":
            x, y = take(2)
            pos = (ox + x, oy + y)
            cur.append(pos)
            last_ctrl = None
        elif c == "H":
            (x,) = take(1)
            pos = ((pos[0] + x) if rel else x, pos[1])
            cur.append(pos)
            last_ctrl = None
        elif c == "V":
            (y,) = take(1)
            pos = (pos[0], (pos[1] + y) if rel else y)
            cur.append(pos)
            last_ctrl = None
        elif c == "C":
            x1, y1, x2, y2, x, y = take(6)
            p1, p2, p3 = (ox + x1, oy + y1), (ox + x2, oy + y2), (ox + x, oy + y)
            cur.extend(curve(pos, p1, p2, p3))
            pos, last_ctrl = p3, p2
        elif c == "S":
            x2, y2, x, y = take(4)
            p1 = (2 * pos[0] - last_ctrl[0], 2 * pos[1] - last_ctrl[1]) if last_ctrl else pos
            p2, p3 = (ox + x2, oy + y2), (ox + x, oy + y)
            cur.extend(curve(pos, p1, p2, p3))
            pos, last_ctrl = p3, p2
        elif c == "Q":
            x1, y1, x, y = take(4)
            q1, p3 = (ox + x1, oy + y1), (ox + x, oy + y)
            p1 = (pos[0] + 2 / 3 * (q1[0] - pos[0]), pos[1] + 2 / 3 * (q1[1] - pos[1]))
            p2 = (p3[0] + 2 / 3 * (q1[0] - p3[0]), p3[1] + 2 / 3 * (q1[1] - p3[1]))
            cur.extend(curve(pos, p1, p2, p3))
            pos, last_ctrl = p3, None
        elif c == "A":
            _rx, _ry, _rot, _large, _sweep, x, y = take(7)
            pos = (ox + x, oy + y)
            cur.append(pos)
            last_ctrl = None
        else:  # T or anything unexpected: skip its coordinates
            take(2)
    if cur:
        polys.append(cur)
    return polys


def bbox(points):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return (min(xs), min(ys), max(xs), max(ys))


def seg_intersects(a, b, c, d):
    """Proper intersection of segments ab and cd; returns the point or None."""
    d1 = (b[0] - a[0], b[1] - a[1])
    d2 = (d[0] - c[0], d[1] - c[1])
    den = d1[0] * d2[1] - d1[1] * d2[0]
    if abs(den) < 1e-9:
        return None  # parallel or collinear: not a crossing
    t = ((c[0] - a[0]) * d2[1] - (c[1] - a[1]) * d2[0]) / den
    u = ((c[0] - a[0]) * d1[1] - (c[1] - a[1]) * d1[0]) / den
    if 0 < t < 1 and 0 < u < 1:
        return (a[0] + t * d1[0], a[1] + t * d1[1])
    return None


def seg_hits_box(a, b, box, inset=0.0):
    """Does segment ab pass through the interior of box (Liang-Barsky)?"""
    x0, y0, x1, y1 = box[0] + inset, box[1] + inset, box[2] - inset, box[3] - inset
    if x1 <= x0 or y1 <= y0:
        return False
    dx, dy = b[0] - a[0], b[1] - a[1]
    lo, hi = 0.0, 1.0
    for p, q in ((-dx, a[0] - x0), (dx, x1 - a[0]), (-dy, a[1] - y0), (dy, y1 - a[1])):
        if abs(p) < 1e-12:
            if q < 0:
                return False
            continue
        r = q / p
        if p < 0:
            lo = max(lo, r)
        else:
            hi = min(hi, r)
        if lo > hi:
            return False
    return hi - lo > 1e-6


def point_seg_dist(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    if dx == dy == 0:
        return math.dist(p, a)
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
    return math.dist(p, (a[0] + t * dx, a[1] + t * dy))


def box_seg_dist(box, a, b):
    if seg_hits_box(a, b, box) or (box[0] <= a[0] <= box[2] and box[1] <= a[1] <= box[3]):
        return 0.0
    corners = [(box[0], box[1]), (box[2], box[1]), (box[2], box[3]), (box[0], box[3])]
    edges = list(zip(corners, corners[1:] + corners[:1]))
    best = min(point_seg_dist(c, a, b) for c in corners)
    best = min(best, point_seg_dist(a, *edges[0]), point_seg_dist(b, *edges[0]))
    for e in edges:
        best = min(best, point_seg_dist(a, *e), point_seg_dist(b, *e))
    return best


def segments(polys):
    return [(p[k], p[k + 1]) for p in polys for k in range(len(p) - 1) if p[k] != p[k + 1]]


# ---------------------------------------------------------------- reading


def walk(node, groups=()):
    tag = node.tag.replace(SVG_NS, "")
    if tag in SKIP:
        return
    if tag == "g":
        groups = groups + (node.get("class", ""),)
    yield tag, node, groups
    for child in node:
        yield from walk(child, groups)


def read(path):
    raw = open(path, encoding="utf-8").read()
    root = ET.fromstring(raw.encode("utf-8"))
    view = [float(v) for v in root.get("viewBox").split()]
    width, height = view[2], view[3]
    tool = "d2" if "data-d2-version" in raw else "cairn"
    fonts = d2_fonts(raw) if tool == "d2" else {}

    edges, boxes, texts = [], [], []
    for tag, node, groups in walk(root):
        if tag == "path" and (node.get("marker-end") or node.get("marker-start")):
            edges.append({"polys": path_points(node.get("d", "")), "group": groups[-1] if groups else ""})
        elif tag in ("rect", "ellipse", "circle", "path", "polygon"):
            stroke = node.get("stroke")
            style = node.get("style", "")
            if not stroke or stroke == "none" or "stroke-width:0" in style.replace(" ", "") or node.get("stroke-width") == "0":
                continue
            if tag == "rect":
                x, y = num(node.get("x")), num(node.get("y"))
                b = (x, y, x + num(node.get("width")), y + num(node.get("height")))
            elif tag == "ellipse":
                cx, cy, rx, ry = (num(node.get(k)) for k in ("cx", "cy", "rx", "ry"))
                b = (cx - rx, cy - ry, cx + rx, cy + ry)
            elif tag == "circle":
                cx, cy, r = (num(node.get(k)) for k in ("cx", "cy", "r"))
                b = (cx - r, cy - r, cx + r, cy + r)
            elif tag == "polygon":
                pts = [float(v) for v in re.findall(r"-?[\d.]+", node.get("points", ""))]
                b = bbox(list(zip(pts[::2], pts[1::2]))) if pts else None
            else:
                polys = path_points(node.get("d", ""))
                b = bbox([p for poly in polys for p in poly]) if polys else None
            if b and b[2] - b[0] >= MIN_BOX[0] and b[3] - b[1] >= MIN_BOX[1]:
                boxes.append(b)
        elif tag == "text":
            texts.extend(text_lines(node, groups, tool, fonts))

    # A box that holds another box is a container: lines cross containers by design.
    leaves = [b for b in boxes if not any(o is not b and o[0] >= b[0] - 1 and o[1] >= b[1] - 1 and o[2] <= b[2] + 1 and o[3] <= b[3] + 1 and o != b for o in boxes)]
    return {"tool": tool, "width": width, "height": height, "edges": edges, "boxes": leaves, "texts": texts}


def text_lines(node, groups, tool, fonts):
    """One entry per rendered line: (box, font size, group)."""
    size = num(node.get("font-size"), 0) or num((re.search(r"font-size:\s*([\d.]+)", node.get("style", "")) or [None, None])[1], 16)
    anchor = node.get("text-anchor") or (re.search(r"text-anchor:\s*(\w+)", node.get("style", "")) or [None, "start"])[1]
    cls = node.get("class", "")
    if tool == "d2":
        style = "bold" if "text-bold" in cls else "italic" if "text-italic" in cls else "regular"
        font = fonts.get(style) or fonts.get("regular")
    else:
        bold = node.get("font-weight") in ("bold", "600", "700")
        italic = node.get("font-style") == "italic"
        font = liberation("BoldItalic" if bold and italic else "Bold" if bold else "Italic" if italic else "Regular")
    x, y = num(node.get("x")), num(node.get("y"))
    pieces = []
    spans = list(node.iter(f"{SVG_NS}tspan"))
    if spans:
        for span in spans:
            x = num(span.get("x"), x)
            y = num(span.get("y"), y) + num(span.get("dy"), 0)
            pieces.append((x, y, "".join(span.itertext())))
    else:
        pieces.append((x, y, "".join(node.itertext())))
    out = []
    for px, py, content in pieces:
        content = content.strip()
        if not content:
            continue
        w = font.width(content, size)
        left = px - w / 2 if anchor == "middle" else px - w if anchor == "end" else px
        out.append({"box": (left, py - 0.75 * size, left + w, py + 0.25 * size), "size": size, "group": groups[-1] if groups else "", "text": content})
    return out


# ---------------------------------------------------------------- metrics


def measure(path):
    d = read(path)
    edges, texts, leaves = d["edges"], d["texts"], d["boxes"]
    for e in edges:
        e["segs"] = segments(e["polys"])
        pts = [p for poly in e["polys"] for p in poly]
        e["ends"] = (pts[0], pts[-1]) if pts else None

    # text lines overlapping each other
    overlaps = 0
    for i in range(len(texts)):
        a = texts[i]["box"]
        for j in range(i + 1, len(texts)):
            b = texts[j]["box"]
            if min(a[2], b[2]) - max(a[0], b[0]) > 0.5 and min(a[3], b[3]) - max(a[1], b[1]) > 0.5:
                overlaps += 1

    # text crossed by a line that isn't its own
    crossed, agree, judged = 0, 0, 0
    for t in texts:
        dists = [min((box_seg_dist(t["box"], *s) for s in e["segs"]), default=math.inf) for e in edges]
        own = min(range(len(edges)), key=lambda k: dists[k]) if edges and min(dists) <= OWN_DIST else None
        if d["tool"] == "d2" and t["group"] and any(e["group"] == t["group"] for e in edges):
            judged += 1
            agree += own is not None and edges[own]["group"] == t["group"]
        hits = [k for k, e in enumerate(edges) if k != own and any(seg_hits_box(a, b, t["box"], inset=1.0) for a, b in e["segs"])]
        crossed += bool(hits)

    # lines crossing each other
    crossings = 0
    for i in range(len(edges)):
        for j in range(i + 1, len(edges)):
            ends = [p for p in (edges[i]["ends"] or ()) + (edges[j]["ends"] or ())]
            found = False
            for a, b in edges[i]["segs"]:
                for c, e2 in edges[j]["segs"]:
                    p = seg_intersects(a, b, c, e2)
                    if p and all(math.dist(p, q) > ENDPOINT_TOL for q in ends):
                        found = True
                        break
                if found:
                    break
            crossings += found

    # lines through a box that is neither their source nor their target
    def near(box, p):
        return box[0] - ENDPOINT_TOL <= p[0] <= box[2] + ENDPOINT_TOL and box[1] - ENDPOINT_TOL <= p[1] <= box[3] + ENDPOINT_TOL

    through = 0
    for e in edges:
        if not e["ends"]:
            continue
        for box in leaves:
            if near(box, e["ends"][0]) or near(box, e["ends"][1]):
                continue
            if any(seg_hits_box(a, b, box, inset=2.0) for a, b in e["segs"]):
                through += 1

    smallest = min((t["size"] for t in texts), default=0)
    a4 = min(A4[0] / d["width"], A4[1] / d["height"])
    slide = min(SLIDE[0] / d["width"], SLIDE[1] / d["height"])
    result = {
        "file": path.split("/")[-1],
        "tool": d["tool"],
        "flows": len(edges),
        "text_lines": len(texts),
        "text_overlaps": overlaps,
        "text_crossed": crossed,
        "edge_crossings": crossings,
        "through_boxes": through,
        "width": round(d["width"]),
        "height": round(d["height"]),
        "a4_min_px": round(smallest * a4, 1),
        "slide_min_px": round(smallest * slide, 1),
    }
    if judged:
        result["owner_agreement"] = round(agree / judged, 3)
    return result


def main(argv):
    as_json = "--json" in argv
    files = [a for a in argv if not a.startswith("--")]
    rows = [measure(f) for f in files]
    if not as_json:
        cols = ["file", "flows", "text_overlaps", "text_crossed", "edge_crossings", "through_boxes", "width", "height", "a4_min_px", "slide_min_px", "owner_agreement"]
        print("\t".join(cols))
        for r in rows:
            print("\t".join(str(r.get(c, "")) for c in cols))
    print(json.dumps(rows, indent=1) if as_json else "", end="")


if __name__ == "__main__":
    main(sys.argv[1:])
