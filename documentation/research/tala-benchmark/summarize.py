#!/usr/bin/env python3
"""Summarize results.json from measure.py, per tool and head to head.

    python3 summarize.py results.json

Views are grouped by content. The theme, disposition and placement variants of
an example give D2 the same input as their base example (the translation drops
cairn's styling), so they are reported apart from the views with distinct
content, which are the headline numbers.
"""

import collections
import json
import statistics
import sys

TOOLS = ["cairn", "d2-tala", "d2-elk", "d2-dagre"]
COUNTS = ["text_overlaps", "text_crossed", "edge_crossings", "through_boxes"]


def group(view):
    for prefix in ("dispositions__", "themes__", "placement__"):
        if view.startswith(prefix):
            return prefix.rstrip("_")
    return "distinct content"


def head_to_head(views, by, other, metric):
    """Views where cairn is better / equal / worse than `other` on `metric`."""
    better = equal = worse = 0
    for v in views:
        c, o = by[v]["cairn"], by[v][other]
        if metric == "area":
            cv, ov = -c["width"] * c["height"], -o["width"] * o["height"]
        elif metric == "a4_min_px":
            cv, ov = c[metric], o[metric]
        else:
            cv, ov = -c[metric], -o[metric]
        better += cv > ov
        equal += cv == ov
        worse += cv < ov
    return better, equal, worse


def summary(name, views, by):
    tools = [t for t in TOOLS if all(t in by[v] for v in views)]
    print(f"\n== {name}: {len(views)} views")
    print(f"{'':28}" + "".join(f"{t:>11}" for t in tools))
    for m in COUNTS:
        print(f"{m + ' (total)':28}" + "".join(f"{sum(by[v][t][m] for v in views):>11}" for t in tools))
    for m in ("text_overlaps", "text_crossed"):
        print(f"{'views with 0 ' + m:28}" + "".join(f"{sum(by[v][t][m] == 0 for v in views):>11}" for t in tools))
    print(f"{'canvas area, median (Mpx2)':28}" + "".join(f"{statistics.median(by[v][t]['width'] * by[v][t]['height'] for v in views) / 1e6:>11.2f}" for t in tools))
    print(f"{'smallest text on A4, median':28}" + "".join(f"{statistics.median(by[v][t]['a4_min_px'] for v in views):>11.1f}" for t in tools))
    print(f"{'smallest text on slide, med.':28}" + "".join(f"{statistics.median(by[v][t]['slide_min_px'] for v in views):>11.1f}" for t in tools))
    if "d2-tala" in tools:
        print("cairn vs D2 + TALA, views where cairn is better / equal / worse:")
        for m in COUNTS + ["area", "a4_min_px"]:
            b, e, w = head_to_head(views, by, "d2-tala", m)
            print(f"   {m:26} {b:>3} / {e:>3} / {w:>3}")


def main(path):
    by = collections.defaultdict(dict)
    for row in json.load(open(path)):
        view, tool = row["file"].rsplit(".", 2)[:2]
        by[view][tool] = row
    groups = collections.defaultdict(list)
    for view in sorted(by):
        groups[group(view)].append(view)
    for name in ("distinct content", "placement", "dispositions", "themes"):
        if groups[name]:
            summary(name, groups[name], by)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "results.json")
