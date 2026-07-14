// View-driven validation: structural rules + completeness checks.

import type { Model, Element, Diagnostic, View } from './model.ts';
import { views } from './model.ts';

export function validate(model: Model): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const view = model.type ? views[model.type] : undefined;

  if (model.type && !view) {
    diags.push({
      code: 'E0200', severity: 'error',
      message: `unknown diagram type \`${model.type}\``,
      span: model.typeSpan!,
      help: `available types: ${Object.keys(views).join(', ')} (application and infrastructure land in phase 3)`,
    });
    return diags;
  }
  if (!view) return diags; // header error already reported by parser

  const all: Element[] = [];
  (function walk(els: Element[]) { for (const e of els) { all.push(e); walk(e.children); } })(model.elements);

  // E0202 duplicate ids
  const seen = new Map<string, Element>();
  for (const e of all) {
    const prev = seen.get(e.id);
    if (prev) {
      diags.push({
        code: 'E0202', severity: 'error',
        message: `duplicate identifier \`${e.id}\``,
        span: e.idSpan,
        note: `already declared at line ${prev.idSpan.line}`,
        help: `rename one of the two, e.g. \`${e.id}_2\` (decision D1: flat unique IDs)`,
      });
    } else seen.set(e.id, e);
  }

  // E0201 unknown kind
  for (const e of all) {
    if (!view.kinds.includes(e.kind)) {
      diags.push({
        code: 'E0201', severity: 'error',
        message: `unknown element kind \`${e.kind}\``,
        span: e.kindSpan,
        note: `the \`${view.name}\` view defines: ${view.kinds.join(', ')}`,
        help: nearest(e.kind, view.kinds) ? `did you mean \`${nearest(e.kind, view.kinds)}\`?` : undefined,
      });
    }
  }

  // W0502: unlabeled elements (the ID would be displayed as-is)
  for (const e of all) {
    if (!e.label) {
      diags.push({
        code: 'W0502', severity: 'warning',
        message: `element without a label (\`${e.id}\` will be displayed as-is)`,
        span: e.idSpan,
        help: `add a display label: \`${e.kind} ${e.id} "Readable name"\``,
      });
    }
  }

  // nesting rules
  for (const rule of view.nesting) {
    for (const e of all) {
      if (e.kind !== rule.child) continue;
      const pk = e.parent?.kind;
      if (!pk || !rule.parents.includes(pk)) {
        diags.push({
          code: rule.code, severity: 'error',
          message: rule.message + ` (\`${e.id}\`)`,
          span: e.idSpan,
          note: pk ? `current parent: \`${pk}\`` : 'declared at the diagram root',
          help: rule.help,
        });
      }
    }
  }

  // flow checks
  for (const f of model.flows) {
    for (const [ref, span] of [[f.from, f.fromSpan], [f.to, f.toSpan]] as const) {
      if (!model.index.has(ref)) {
        diags.push({
          code: 'E0220', severity: 'error',
          message: `unknown reference \`${ref}\``,
          span,
          help: nearest(ref, [...model.index.keys()]) ? `did you mean \`${nearest(ref, [...model.index.keys()])}\`?` : 'declare this element before referencing it',
        });
      }
    }
    if (view.flowTechRecommended && !f.tech?.protocol) {
      const isActor = (id: string) => {
        const k = model.index.get(id)?.kind;
        return k === 'actor' || k === 'actor-group';
      };
      if (!isActor(f.from) && !isActor(f.to)) {
        diags.push({
          code: view.flowTechRecommended.code, severity: 'warning',
          message: view.flowTechRecommended.message,
          span: f.span,
          note: `completeness check of the \`${view.name}\` view (actor flows are exempt)`,
          help: view.flowTechRecommended.help,
        });
      }
    }
    if (view.flowTechRequired && !f.tech?.protocol) {
      diags.push({
        code: view.flowTechRequired.code, severity: 'error',
        message: view.flowTechRequired.message,
        span: f.span,
        note: `the \`${view.name}\` view requires the protocol on every flow`,
        help: view.flowTechRequired.help,
        fix: { insert: ' (HTTPS/443)', atEndOfLine: true },
      });
    }
    if (view.flowLabelRequired && !f.label) {
      diags.push({
        code: view.flowLabelRequired.code, severity: 'error',
        message: view.flowLabelRequired.message,
        span: f.span,
        note: `the \`${view.name}\` view forbids unlabelled arrows`,
        help: view.flowLabelRequired.help,
        fix: { insert: ' : "…"', atEndOfLine: true },
      });
    }
  }

  // attrSpec: required element attribute with a closed value set (security: trust-zone level)
  if (view.attrSpec) {
    const spec = view.attrSpec;
    for (const e of all) {
      if (e.kind !== spec.kind) continue;
      if (!e.attr) {
        diags.push({
          code: spec.code, severity: 'error', message: spec.message + ` (\`${e.id}\`)`,
          span: e.idSpan, help: spec.help,
        });
      } else if (!spec.values.includes(e.attr.value)) {
        diags.push({
          code: spec.code, severity: 'error',
          message: `invalid ${spec.kind} value \`${e.attr.value}\` (\`${e.id}\`)`,
          span: e.attr.span,
          note: `allowed: ${spec.values.join(', ')}`,
          help: nearest(e.attr.value, spec.values) ? `did you mean \`${nearest(e.attr.value, spec.values)}\`?` : spec.help,
        });
      }
    }
  }

  // security view: trust-boundary crossing + cross-zone encryption checks
  if (view.boundaryLint || view.crossZoneTechRecommended) {
    const zoneOf = (id: string): Element | undefined => {
      for (let a = model.index.get(id)?.parent; a; a = a.parent) if (a.kind === 'trust-zone') return a;
      return undefined;
    };
    const levelOf = (id: string): number => {
      const z = zoneOf(id);
      const v = z?.attr?.value;
      return (v && view.trustOrder?.[v] !== undefined) ? view.trustOrder[v] : -1; // outside any zone = least trusted
    };
    for (const f of model.flows) {
      if (!model.index.has(f.from) || !model.index.has(f.to)) continue; // ref errors already reported
      const zf = zoneOf(f.from), zt = zoneOf(f.to);
      const crossing = zf !== zt;
      if (view.boundaryLint) {
        const bl = view.boundaryLint;
        const isNode = (id: string) => model.index.get(id)?.kind === bl.nodeKind;
        if (levelOf(f.to) > levelOf(f.from) && !isNode(f.from) && !isNode(f.to)) {
          diags.push({
            code: bl.code, severity: 'warning', message: bl.message,
            span: f.span,
            note: `flow enters a more-trusted zone without passing a \`${bl.nodeKind}\``,
            help: bl.help,
          });
        }
      }
      if (view.crossZoneTechRecommended && crossing && !f.tech?.protocol) {
        diags.push({
          code: view.crossZoneTechRecommended.code, severity: 'warning',
          message: view.crossZoneTechRecommended.message,
          span: f.span,
          note: 'inter-zone flow — state how the traffic is protected',
          help: view.crossZoneTechRecommended.help,
        });
      }
    }
  }

  // business objects: unique ids, valid refs, usage completeness
  const boIds = new Map(model.businessObjects.map(b => [b.id, b]));
  for (const b of model.businessObjects) {
    if (model.index.has(b.id)) {
      diags.push({
        code: 'E0202', severity: 'error',
        message: `duplicate identifier \`${b.id}\` (already used by an element)`,
        span: b.idSpan, help: 'business objects share the flat ID namespace (decision D1)',
      });
    }
  }
  const carried = new Set<string>();
  for (const f of model.flows) {
    for (const o of f.objects ?? []) {
      if (!boIds.has(o.id)) {
        diags.push({
          code: 'E0221', severity: 'error',
          message: `unknown business-object reference \`${o.id}\``,
          span: o.span,
          help: nearest(o.id, [...boIds.keys()]) ? `did you mean \`${nearest(o.id, [...boIds.keys()])}\`?` : 'declare it: `business-object ' + o.id + ' "Name" "description"`',
        });
      } else carried.add(o.id);
    }
  }
  for (const b of model.businessObjects) {
    if (!carried.has(b.id)) {
      diags.push({
        code: 'W0530', severity: 'warning',
        message: `business object \`${b.id}\` is never carried by any flow`,
        span: b.idSpan,
        note: `completeness check of the \`${view.name}\` view`,
      });
    }
  }

  // completeness: min counts
  for (const mc of view.minCounts) {
    const n = all.filter(e => e.kind === mc.kind).length;
    if (n < mc.min) {
      diags.push({
        code: mc.code, severity: 'warning',
        message: mc.message,
        span: model.typeSpan ?? { line: 1, col: 1, len: 7 },
        note: `completeness check of the \`${view.name}\` view`,
      });
    }
  }

  // completeness: isolated leaves (an element participates via itself or any ancestor/descendant)
  if (view.isolatedWarn) {
    const touched = new Set<string>();
    const touch = (id: string) => {
      const el = model.index.get(id);
      if (!el) return;
      (function down(e: Element) { touched.add(e.id); e.children.forEach(down); })(el);
      for (let a = el.parent; a; a = a.parent) touched.add(a.id);
    };
    for (const f of model.flows) { touch(f.from); touch(f.to); }
    for (const e of all) {
      if (view.isolatedWarn.kinds.includes(e.kind) && !touched.has(e.id)) {
        diags.push({
          code: view.isolatedWarn.code, severity: 'warning',
          message: view.isolatedWarn.message + ` (\`${e.id}\`)`,
          span: e.idSpan,
          note: `completeness check of the \`${view.name}\` view`,
        });
      }
    }
  }

  return diags;
}

// cheap Levenshtein-1/2 suggestion
function nearest(word: string, candidates: string[]): string | undefined {
  let best: string | undefined, bestD = 3;
  for (const c of candidates) {
    const d = lev(word.toLowerCase(), c.toLowerCase(), bestD);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}
function lev(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0]; dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const t = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return dp[a.length];
}
