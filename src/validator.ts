/**
 * Check a parsed model against the rules of its view.
 *
 * Runs after parse.ts and before layout. It reports two kinds of problems as
 * coded Diagnostics (never exceptions): structural errors that block a build
 * (unknown kinds, bad nesting, dangling flow references) and completeness
 * warnings that don't (missing labels, isolated elements, absent protocols).
 *
 * Which rules apply is entirely data-driven: each `View` (see model.ts) carries
 * its own kinds, nesting rules, and per-view checks, so this file contains no
 * per-view `if (type === 'security')` branching — it just runs whatever the
 * active view declares. `validate()` is a thin pipeline; each `check*` helper
 * owns one rule group and returns its diagnostics. The concatenation order is
 * the reporting order, so keep it stable.
 */

import type { Model, Element, View, Diagnostic } from './model.ts';
import { views } from './model.ts';

export function validate(model: Model): Diagnostic[] {
  const view = model.type ? views[model.type] : undefined;

  if (model.type && !view) {
    return [{
      code: 'E0200', severity: 'error',
      message: `unknown diagram type \`${model.type}\``,
      span: model.typeSpan!,
      help: `available types: ${Object.keys(views).join(', ')} (application and infrastructure land in phase 3)`,
    }];
  }
  if (!view) return []; // header error already reported by parser

  const elements = flatten(model.elements);
  return [
    ...checkDuplicateIds(elements),
    ...checkUnknownKinds(elements, view),
    ...checkMissingLabels(elements),
    ...checkNesting(elements, view),
    ...checkFlows(model, view),
    ...checkElementAttributes(elements, view),
    ...checkTrustBoundaries(model, view),
    ...checkBusinessObjects(model, view),
    ...checkMinimumCounts(elements, model, view),
    ...checkIsolatedElements(model, view, elements),
  ];
}

// Depth-first flatten of the element tree into a single list.
function flatten(roots: Element[]): Element[] {
  const out: Element[] = [];
  (function collect(els: Element[]) { for (const e of els) { out.push(e); collect(e.children); } })(roots);
  return out;
}

// E0202 — IDs are flat and unique per file (decision D1).
function checkDuplicateIds(elements: Element[]): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const firstSeen = new Map<string, Element>();
  for (const e of elements) {
    const prev = firstSeen.get(e.id);
    if (prev) {
      diags.push({
        code: 'E0202', severity: 'error',
        message: `duplicate identifier \`${e.id}\``,
        span: e.idSpan,
        note: `already declared at line ${prev.idSpan.line}`,
        help: `rename one of the two, e.g. \`${e.id}_2\` (decision D1: flat unique IDs)`,
      });
    } else firstSeen.set(e.id, e);
  }
  return diags;
}

// E0201 — kind not defined by the active view (with a did-you-mean).
function checkUnknownKinds(elements: Element[], view: View): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const e of elements) {
    if (view.kinds.includes(e.kind)) continue;
    const suggestion = nearest(e.kind, view.kinds);
    diags.push({
      code: 'E0201', severity: 'error',
      message: `unknown element kind \`${e.kind}\``,
      span: e.kindSpan,
      note: `the \`${view.name}\` view defines: ${view.kinds.join(', ')}`,
      help: suggestion ? `did you mean \`${suggestion}\`?` : undefined,
    });
  }
  return diags;
}

// W0502 — no label, so the raw ID would be displayed.
function checkMissingLabels(elements: Element[]): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const e of elements) {
    if (e.label) continue;
    diags.push({
      code: 'W0502', severity: 'warning',
      message: `element without a label (\`${e.id}\` will be displayed as-is)`,
      span: e.idSpan,
      help: `add a display label: \`${e.kind} ${e.id} "Readable name"\``,
    });
  }
  return diags;
}

// Per-view containment rules (a block must sit in a layer/system, etc.).
function checkNesting(elements: Element[], view: View): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const rule of view.nesting) {
    for (const e of elements) {
      if (e.kind !== rule.child) continue;
      const parentKind = e.parent?.kind;
      if (!parentKind || !rule.parents.includes(parentKind)) {
        diags.push({
          code: rule.code, severity: 'error',
          message: rule.message + ` (\`${e.id}\`)`,
          span: e.idSpan,
          note: parentKind ? `current parent: \`${parentKind}\`` : 'declared at the diagram root',
          help: rule.help,
        });
      }
    }
  }
  return diags;
}

// Flow rules: E0220 dangling references, plus the per-view protocol/label
// requirements (technology recommended, protocol required, label required).
function checkFlows(model: Model, view: View): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const isActor = (id: string) => {
    const kind = model.index.get(id)?.kind;
    return kind === 'actor' || kind === 'actor-group';
  };
  for (const f of model.flows) {
    for (const [ref, span] of [[f.from, f.fromSpan], [f.to, f.toSpan]] as const) {
      if (!model.index.has(ref)) {
        const suggestion = nearest(ref, [...model.index.keys()]);
        diags.push({
          code: 'E0220', severity: 'error',
          message: `unknown reference \`${ref}\``,
          span,
          help: suggestion ? `did you mean \`${suggestion}\`?` : 'declare this element before referencing it',
        });
      }
    }
    if (view.flowTechRecommended && !f.tech?.protocol && !isActor(f.from) && !isActor(f.to)) {
      diags.push({
        code: view.flowTechRecommended.code, severity: 'warning',
        message: view.flowTechRecommended.message,
        span: f.span,
        note: `completeness check of the \`${view.name}\` view (actor flows are exempt)`,
        help: view.flowTechRecommended.help,
      });
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
  return diags;
}

// A required element attribute with a closed value set (security: trust-zone level).
function checkElementAttributes(elements: Element[], view: View): Diagnostic[] {
  const spec = view.attrSpec;
  if (!spec) return [];
  const diags: Diagnostic[] = [];
  for (const e of elements) {
    if (e.kind !== spec.kind) continue;
    if (!e.attr) {
      diags.push({
        code: spec.code, severity: 'error', message: spec.message + ` (\`${e.id}\`)`,
        span: e.idSpan, help: spec.help,
      });
    } else if (!spec.values.includes(e.attr.value)) {
      const suggestion = nearest(e.attr.value, spec.values);
      diags.push({
        code: spec.code, severity: 'error',
        message: `invalid ${spec.kind} value \`${e.attr.value}\` (\`${e.id}\`)`,
        span: e.attr.span,
        note: `allowed: ${spec.values.join(', ')}`,
        help: suggestion ? `did you mean \`${suggestion}\`?` : spec.help,
      });
    }
  }
  return diags;
}

// Security view: warn on a trust-boundary crossing that skips a security-node,
// and on a cross-zone flow that doesn't state its encryption/protocol.
function checkTrustBoundaries(model: Model, view: View): Diagnostic[] {
  if (!view.boundaryLint && !view.crossZoneTechRecommended) return [];
  const diags: Diagnostic[] = [];

  const zoneOf = (id: string): Element | undefined => {
    for (let a = model.index.get(id)?.parent; a; a = a.parent) if (a.kind === 'trust-zone') return a;
    return undefined;
  };
  const trustLevelOf = (id: string): number => {
    const level = zoneOf(id)?.attr?.value;
    return (level && view.trustOrder?.[level] !== undefined) ? view.trustOrder[level] : -1; // outside any zone = least trusted
  };

  for (const f of model.flows) {
    if (!model.index.has(f.from) || !model.index.has(f.to)) continue; // ref errors already reported
    const crossesZone = zoneOf(f.from) !== zoneOf(f.to);
    if (view.boundaryLint) {
      const lint = view.boundaryLint;
      const isSecurityNode = (id: string) => model.index.get(id)?.kind === lint.nodeKind;
      if (trustLevelOf(f.to) > trustLevelOf(f.from) && !isSecurityNode(f.from) && !isSecurityNode(f.to)) {
        diags.push({
          code: lint.code, severity: 'warning', message: lint.message,
          span: f.span,
          note: `flow enters a more-trusted zone without passing a \`${lint.nodeKind}\``,
          help: lint.help,
        });
      }
    }
    if (view.crossZoneTechRecommended && crossesZone && !f.tech?.protocol) {
      diags.push({
        code: view.crossZoneTechRecommended.code, severity: 'warning',
        message: view.crossZoneTechRecommended.message,
        span: f.span,
        note: 'inter-zone flow — state how the traffic is protected',
        help: view.crossZoneTechRecommended.help,
      });
    }
  }
  return diags;
}

// Business objects are a logical-view concept (issue #19). Outside the logical
// view any declaration or `[ref]` is an error (E0222); inside it, we check for
// unique IDs, valid references (E0221), and unused declarations (W0530).
function checkBusinessObjects(model: Model, view: View): Diagnostic[] {
  const diags: Diagnostic[] = [];

  if (!view.businessObjects) {
    for (const bo of model.businessObjects) {
      diags.push({
        code: 'E0222', severity: 'error',
        message: `business objects are not part of the \`${view.name}\` view (\`${bo.id}\`)`,
        span: bo.idSpan,
        help: 'business objects belong to the `logical` view — remove it, or model the exchange with the flow label',
      });
    }
    for (const f of model.flows) {
      for (const o of f.objects ?? []) {
        diags.push({
          code: 'E0222', severity: 'error',
          message: `business-object reference \`[${o.id}]\` is not part of the \`${view.name}\` view`,
          span: o.span,
          help: 'drop the `[…]` reference — business objects are a logical-view feature',
        });
      }
    }
    return diags;
  }

  const declaredIds = new Map<string, (typeof model.businessObjects)[number]>();
  for (const bo of model.businessObjects) {
    const prev = declaredIds.get(bo.id);
    if (prev) {
      diags.push({
        code: 'E0202', severity: 'error',
        message: `duplicate identifier \`${bo.id}\``,
        span: bo.idSpan,
        note: `already declared at line ${prev.idSpan.line}`,
        help: `rename one of the two, e.g. \`${bo.id}_2\` (decision D1: flat unique IDs)`,
      });
    } else if (model.index.has(bo.id)) {
      diags.push({
        code: 'E0202', severity: 'error',
        message: `duplicate identifier \`${bo.id}\` (already used by an element)`,
        span: bo.idSpan, help: 'business objects share the flat ID namespace (decision D1)',
      });
    }
    if (!prev) declaredIds.set(bo.id, bo);
  }

  const carried = new Set<string>();
  for (const f of model.flows) {
    for (const o of f.objects ?? []) {
      if (!declaredIds.has(o.id)) {
        const suggestion = nearest(o.id, [...declaredIds.keys()]);
        diags.push({
          code: 'E0221', severity: 'error',
          message: `unknown business-object reference \`${o.id}\``,
          span: o.span,
          help: suggestion ? `did you mean \`${suggestion}\`?` : 'declare it: `business-object ' + o.id + ' "Name" "description"`',
        });
      } else carried.add(o.id);
    }
  }

  for (const bo of model.businessObjects) {
    if (!carried.has(bo.id)) {
      diags.push({
        code: 'W0530', severity: 'warning',
        message: `business object \`${bo.id}\` is never carried by any flow`,
        span: bo.idSpan,
        note: `completeness check of the \`${view.name}\` view`,
      });
    }
  }
  return diags;
}

// Completeness: a kind declared fewer times than the view's minimum.
function checkMinimumCounts(elements: Element[], model: Model, view: View): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const rule of view.minCounts) {
    const declared = elements.filter(e => e.kind === rule.kind).length;
    if (declared < rule.min) {
      diags.push({
        code: rule.code, severity: 'warning',
        message: rule.message,
        span: model.typeSpan ?? { line: 1, col: 1, len: 7 },
        note: `completeness check of the \`${view.name}\` view`,
      });
    }
  }
  return diags;
}

// Completeness: an element with no flow at all. An element counts as connected
// if it — or any ancestor or descendant — is an endpoint of some flow.
function checkIsolatedElements(model: Model, view: View, elements: Element[]): Diagnostic[] {
  if (!view.isolatedWarn) return [];
  const diags: Diagnostic[] = [];

  const connected = new Set<string>();
  const markConnected = (id: string) => {
    const el = model.index.get(id);
    if (!el) return;
    (function markSubtree(e: Element) { connected.add(e.id); e.children.forEach(markSubtree); })(el);
    for (let a = el.parent; a; a = a.parent) connected.add(a.id);
  };
  for (const f of model.flows) { markConnected(f.from); markConnected(f.to); }

  for (const e of elements) {
    if (view.isolatedWarn.kinds.includes(e.kind) && !connected.has(e.id)) {
      diags.push({
        code: view.isolatedWarn.code, severity: 'warning',
        message: view.isolatedWarn.message + ` (\`${e.id}\`)`,
        span: e.idSpan,
        note: `completeness check of the \`${view.name}\` view`,
      });
    }
  }
  return diags;
}

// Cheap capped Levenshtein for "did you mean" suggestions (distance < 3).
function nearest(word: string, candidates: string[]): string | undefined {
  let best: string | undefined, bestDistance = 3;
  for (const candidate of candidates) {
    const distance = levenshtein(word.toLowerCase(), candidate.toLowerCase(), bestDistance);
    if (distance < bestDistance) { bestDistance = distance; best = candidate; }
  }
  return best;
}

function levenshtein(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0]; dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const above = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = above;
    }
  }
  return dp[a.length];
}
