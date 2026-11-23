/**
 * Translate a cairn view into D2, mechanically, so the benchmark compares
 * layouts of the same content rather than two hand-written diagrams.
 *
 *     node --experimental-strip-types to-d2.ts <view.cairn> > <view.d2>
 *
 * What carries over, one for one:
 * - every element, with its label, nested exactly as in cairn (D2 containers);
 * - every flow, with the text cairn draws on the arrow: its label, its
 *   technology tail `(PROTOCOL, FORMAT)` or `(PROTOCOL/PORT)`, and the names of
 *   the business objects it carries;
 * - dashed and dotted flows;
 * - the reading direction (left to right), as cairn draws it.
 *
 * Shapes: a cairn kind becomes the D2 shape that means the same thing where D2
 * has one (actor → person, datastore → cylinder, queue → queue); everything
 * else stays D2's default rectangle. No colours, no icons, no layout hints:
 * the layout engine gets the content and nothing else. The cairn file keeps
 * whatever its author wrote, as a cairn user would.
 *
 * What doesn't carry over: cairn's title, legend and business-object table.
 * They are chrome around the view, not part of its layout.
 */

import { readFileSync } from "node:fs";
import { parse } from "../../../src/parser.ts";

type El = { kind: string; id: string; label?: string; children: El[] };
type Flow = {
  from: string;
  to: string;
  label?: string;
  tech?: { protocol?: string; format?: string };
  objects?: { id: string }[];
  lineStyle?: "dashed" | "dotted";
};

const SHAPES: Record<string, string> = {
  actor: "person",
  datastore: "cylinder",
  queue: "queue",
};

const source = readFileSync(process.argv[2], "utf8");
const { model, diags } = parse(source);
const errors = diags.filter((d) => d.severity === "error");
if (errors.length) {
  console.error(errors.map((d) => `${d.code} ${d.message}`).join("\n"));
  process.exit(1);
}

const q = (text: string) => JSON.stringify(text); // D2 double-quoted string; \n stays a line break
const path = new Map<string, string>();
const lines: string[] = ["direction: right", ""];

function walk(el: El, prefix: string, depth: number) {
  const key = prefix ? `${prefix}.${q(el.id)}` : q(el.id);
  path.set(el.id, key);
  const pad = "  ".repeat(depth);
  const label = el.label ?? el.id;
  const shape = SHAPES[el.kind];
  if (!el.children.length && !shape) {
    lines.push(`${pad}${q(el.id)}: ${q(label)}`);
    return;
  }
  lines.push(`${pad}${q(el.id)}: ${q(label)} {`);
  if (shape) lines.push(`${pad}  shape: ${shape}`);
  for (const child of el.children) walk(child, key, depth + 1);
  lines.push(`${pad}}`);
}

for (const el of model.elements as El[]) walk(el, "", 0);
lines.push("");

const objectName = new Map<string, string>(
  (model.businessObjects ?? []).map((bo: { id: string; name: string }) => [bo.id, bo.name]),
);
const tail = (flow: Flow) => {
  const tech = flow.tech;
  if (!tech?.protocol) return "";
  if (model.type === "infrastructure") return `(${tech.protocol})`;
  return tech.format ? `(${tech.protocol}, ${tech.format})` : `(${tech.protocol})`;
};

for (const flow of model.flows as Flow[]) {
  const parts = [
    flow.label,
    tail(flow),
    (flow.objects ?? []).map((o) => objectName.get(o.id) ?? o.id).join(", "),
  ].filter(Boolean);
  const from = path.get(flow.from);
  const to = path.get(flow.to);
  if (!from || !to) throw new Error(`unknown endpoint in ${flow.from} -> ${flow.to}`);
  const text = parts.length ? `: ${q(parts.join("\n"))}` : "";
  const dash = flow.lineStyle === "dashed" ? 5 : flow.lineStyle === "dotted" ? 2 : 0;
  lines.push(`${from} -> ${to}${text}${dash ? ` {style.stroke-dash: ${dash}}` : ""}`);
}

process.stdout.write(`${lines.join("\n")}\n`);
