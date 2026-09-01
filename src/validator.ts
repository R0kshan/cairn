/**
 * Stage 3: semantic checks over the parsed `Model`, driven by the active view's
 * rules (`views` registry). Runs a battery of focused passes — duplicate IDs,
 * unknown kinds, nesting, flow references, per-view flow requirements, trust
 * boundaries, business objects, minimum counts, isolated elements, placement
 * constraints — each
 * returning `Diagnostic[]`. `nearest`/`editDistance` power the "did you mean?"
 * suggestions. Purely diagnostic: never mutates the model.
 */

import type { Model, Element } from "./models/ast.ts";
import type { Diagnostic } from "./models/diagnostic.ts";
import type { View } from "./views.ts";
import { views } from "./views.ts";
import { subtreeIds, subtreeElements } from "./element-tree.ts";
import { LOGOS, LOGO_NAMES } from "./logos.ts";

/** Validates a parsed model against view-specific rules and returns diagnostic messages. */
export function validate(model: Model): Diagnostic[] {
  const view = model.type ? views[model.type] : undefined;

  if (model.type && !view) {
    return [
      {
        code: "E0200",
        severity: "error",
        message: `unknown diagram type \`${model.type}\``,
        span: model.typeSpan!,
        help: `available types: ${Object.keys(views).join(", ")} (application and infrastructure land in phase 3)`,
      },
    ];
  }
  if (!view) return [];

  const elements = model.elements.flatMap((element) => subtreeElements(element));
  return [
    ...checkDuplicateIds(elements),
    ...checkUnknownKinds(elements, view),
    ...checkMissingLabels(elements),
    ...checkNesting(elements, view),
    ...checkFlows(model, view),
    ...checkElementAttributes(elements, view),
    ...checkLogos(elements, view),
    ...checkTrustBoundaries(model, view),
    ...checkBusinessObjects(model, view),
    ...checkMinimumCounts(elements, model, view),
    ...checkIsolatedElements(model, view, elements),
  ];
}

function checkDuplicateIds(elements: Element[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const firstSeen = new Map<string, Element>();
  for (const element of elements) {
    const previous = firstSeen.get(element.id);
    if (!previous) {
      firstSeen.set(element.id, element);
      continue;
    }
    diagnostics.push({
      code: "E0202",
      severity: "error",
      message: `duplicate identifier \`${element.id}\``,
      span: element.idSpan,
      note: `already declared at line ${previous.idSpan.line}`,
      help: `rename one of the two, e.g. \`${element.id}_2\` (decision D1: flat unique IDs)`,
    });
  }
  return diagnostics;
}

function checkUnknownKinds(elements: Element[], view: View): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const element of elements) {
    if (view.kinds.includes(element.kind)) continue;
    const suggestion = nearest(element.kind, view.kinds);
    diagnostics.push({
      code: "E0201",
      severity: "error",
      message: `unknown element kind \`${element.kind}\``,
      span: element.kindSpan,
      note: `the \`${view.name}\` view defines: ${view.kinds.join(", ")}`,
      help: suggestion ? `did you mean \`${suggestion}\`?` : undefined,
    });
  }
  return diagnostics;
}

/**
 * Everything `logo:` has to satisfy, in one place: the kind takes a logo, a bare
 * name names a built-in, and a quoted value is a workspace path rather than a
 * URL. The parser only settled the shape.
 */
function checkLogos(elements: Element[], view: View): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const logoKinds = view.logoKinds ?? [];
  for (const element of elements) {
    const logo = element.logo;
    if (!logo) continue;

    if (!logoKinds.includes(element.kind)) {
      diagnostics.push({
        code: "E0108",
        severity: "error",
        message: `\`${element.kind}\` does not carry a logo`,
        span: logo.span,
        note: logoKinds.length
          ? `the \`${view.name}\` view accepts \`logo\` on: ${logoKinds.join(", ")}`
          : `the \`${view.name}\` view has no kinds that carry a logo`,
      });
      continue;
    }

    if (logo.source === "builtin") {
      // `hasOwn`, not a plain lookup: `LOGOS` is an object literal, so
      // `logo: constructor` would otherwise find `Object.prototype` and pass
      // for a logo that does not exist.
      if (Object.hasOwn(LOGOS, logo.value)) continue;
      const suggestion = nearest(logo.value, LOGO_NAMES);
      diagnostics.push({
        code: "E0107",
        severity: "error",
        message: `unknown built-in logo \`${logo.value}\``,
        span: logo.span,
        note: `${LOGO_NAMES.length} built-ins available — run \`cairn logos\` to list them`,
        help:
          suggestion !== undefined
            ? `did you mean \`${suggestion}\`?`
            : `use a file instead: \`logo: "./logos/${logo.value}.svg"\``,
      });
      continue;
    }

    // A remote logo would make the diagram fetch on every open. Caught here
    // rather than at read time so the author hears about it from `validate`,
    // and so the playground — which has no filesystem — reports it too.
    if (/^[a-z][a-z0-9+.-]*:/i.test(logo.value) || logo.value.startsWith("//")) {
      diagnostics.push({
        code: "E0105",
        severity: "error",
        message: `\`logo\` will not fetch \`${logo.value}\``,
        span: logo.span,
        note: "a linked logo leaves the diagram depending on a server that can change or vanish",
        help: 'download it next to the diagram and point at the file: `logo: "./logos/name.svg"`',
      });
    }
  }
  return diagnostics;
}

function checkMissingLabels(elements: Element[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const element of elements) {
    if (element.label) continue;
    diagnostics.push({
      code: "W0502",
      severity: "warning",
      message: `element without a label (\`${element.id}\` will be displayed as-is)`,
      span: element.idSpan,
      help: `add a display label: \`${element.kind} ${element.id} "Readable name"\``,
    });
  }
  return diagnostics;
}

function checkNesting(elements: Element[], view: View): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const rule of view.nesting) {
    for (const element of elements) {
      if (element.kind !== rule.child) continue;
      const parentKind = element.parent?.kind;
      if (!parentKind || !rule.parents.includes(parentKind)) {
        diagnostics.push({
          code: rule.code,
          severity: "error",
          message: rule.message + ` (\`${element.id}\`)`,
          span: element.idSpan,
          note: parentKind ? `current parent: \`${parentKind}\`` : "declared at the diagram root",
          help: rule.help,
        });
      }
    }
  }
  return diagnostics;
}

function checkFlows(model: Model, view: View): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const isActor = (id: string) => {
    const kind = model.index.get(id)?.kind;
    return kind === "actor" || kind === "actor-group";
  };
  for (const flow of model.flows) {
    for (const [reference, span] of [
      [flow.from, flow.fromSpan],
      [flow.to, flow.toSpan],
    ] as const) {
      if (!model.index.has(reference)) {
        const suggestion = nearest(reference, [...model.index.keys()]);
        diagnostics.push({
          code: "E0220",
          severity: "error",
          message: `unknown reference \`${reference}\``,
          span,
          help: suggestion
            ? `did you mean \`${suggestion}\`?`
            : "declare this element before referencing it",
        });
      }
    }
    if (
      view.flowTechRecommended &&
      !flow.tech?.protocol &&
      !isActor(flow.from) &&
      !isActor(flow.to)
    ) {
      diagnostics.push({
        code: view.flowTechRecommended.code,
        severity: "warning",
        message: view.flowTechRecommended.message,
        span: flow.span,
        note: `completeness check of the \`${view.name}\` view (actor flows are exempt)`,
        help: view.flowTechRecommended.help,
      });
    }
    if (view.flowTechRequired && !flow.tech?.protocol) {
      diagnostics.push({
        code: view.flowTechRequired.code,
        severity: "error",
        message: view.flowTechRequired.message,
        span: flow.span,
        note: `the \`${view.name}\` view requires the protocol on every flow`,
        help: view.flowTechRequired.help,
        fix: { insert: " (HTTPS/443)", atEndOfLine: true },
      });
    }
    if (view.flowLabelRequired && !flow.label) {
      diagnostics.push({
        code: view.flowLabelRequired.code,
        severity: "error",
        message: view.flowLabelRequired.message,
        span: flow.span,
        note: `the \`${view.name}\` view forbids unlabelled arrows`,
        help: view.flowLabelRequired.help,
        fix: { insert: ' : "…"', atEndOfLine: true },
      });
    }
  }
  return diagnostics;
}

function checkElementAttributes(elements: Element[], view: View): Diagnostic[] {
  const spec = view.attrSpec;
  if (!spec) return [];
  const diagnostics: Diagnostic[] = [];
  for (const element of elements) {
    if (element.kind !== spec.kind) continue;
    if (!element.attr) {
      diagnostics.push({
        code: spec.code,
        severity: "error",
        message: spec.message + ` (\`${element.id}\`)`,
        span: element.idSpan,
        help: spec.help,
      });
    } else if (!spec.values.includes(element.attr.value)) {
      const suggestion = nearest(element.attr.value, spec.values);
      diagnostics.push({
        code: spec.code,
        severity: "error",
        message: `invalid ${spec.kind} value \`${element.attr.value}\` (\`${element.id}\`)`,
        span: element.attr.span,
        note: `allowed: ${spec.values.join(", ")}`,
        help: suggestion ? `did you mean \`${suggestion}\`?` : spec.help,
      });
    }
  }
  return diagnostics;
}

function checkTrustBoundaries(model: Model, view: View): Diagnostic[] {
  if (!view.boundaryLint && !view.crossZoneTechRecommended) return [];
  const diagnostics: Diagnostic[] = [];

  const zoneOf = (id: string): Element | undefined => {
    for (let ancestor = model.index.get(id)?.parent; ancestor; ancestor = ancestor.parent)
      if (ancestor.kind === "trust-zone") return ancestor;
    return undefined;
  };
  const trustLevelOf = (id: string): number => {
    const level = zoneOf(id)?.attr?.value;
    return level && view.trustOrder?.[level] !== undefined ? view.trustOrder[level] : -1;
  };
  const lint = view.boundaryLint;
  const isSecurityNode = (id: string) =>
    lint !== undefined && model.index.get(id)?.kind === lint.nodeKind;

  for (const flow of model.flows) {
    if (!model.index.has(flow.from) || !model.index.has(flow.to)) continue;
    const crossesZone = zoneOf(flow.from) !== zoneOf(flow.to);
    const boundaryViolation =
      lint !== undefined &&
      trustLevelOf(flow.to) > trustLevelOf(flow.from) &&
      !isSecurityNode(flow.from) &&
      !isSecurityNode(flow.to);
    if (boundaryViolation) {
      diagnostics.push({
        code: lint!.code,
        severity: "warning",
        message: lint!.message,
        span: flow.span,
        note: `flow enters a more-trusted zone without passing a \`${lint!.nodeKind}\``,
        help: lint!.help,
      });
    }
    if (view.crossZoneTechRecommended && crossesZone && !flow.tech?.protocol) {
      diagnostics.push({
        code: view.crossZoneTechRecommended.code,
        severity: "warning",
        message: view.crossZoneTechRecommended.message,
        span: flow.span,
        note: "inter-zone flow — state how the traffic is protected",
        help: view.crossZoneTechRecommended.help,
      });
    }
  }
  return diagnostics;
}

/** Every business object/reference is disallowed outright when the view doesn't support them. */
function checkForbiddenBusinessObjects(model: Model, view: View): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const businessObject of model.businessObjects) {
    diagnostics.push({
      code: "E0222",
      severity: "error",
      message: `business objects are not part of the \`${view.name}\` view (\`${businessObject.id}\`)`,
      span: businessObject.idSpan,
      help: "business objects belong to the `logical` view — remove it, or model the exchange with the flow label",
    });
  }
  for (const flow of model.flows) {
    for (const objectRef of flow.objects ?? []) {
      diagnostics.push({
        code: "E0222",
        severity: "error",
        message: `business-object reference \`[${objectRef.id}]\` is not part of the \`${view.name}\` view`,
        span: objectRef.span,
        help: "drop the `[…]` reference — business objects are a logical-view feature",
      });
    }
  }
  return diagnostics;
}

function checkBusinessObjects(model: Model, view: View): Diagnostic[] {
  if (!view.businessObjects) return checkForbiddenBusinessObjects(model, view);

  const diagnostics: Diagnostic[] = [];
  const declaredIds = new Map<string, (typeof model.businessObjects)[number]>();
  for (const businessObject of model.businessObjects) {
    const previous = declaredIds.get(businessObject.id);
    if (previous) {
      diagnostics.push({
        code: "E0202",
        severity: "error",
        message: `duplicate identifier \`${businessObject.id}\``,
        span: businessObject.idSpan,
        note: `already declared at line ${previous.idSpan.line}`,
        help: `rename one of the two, e.g. \`${businessObject.id}_2\` (decision D1: flat unique IDs)`,
      });
    } else if (model.index.has(businessObject.id)) {
      diagnostics.push({
        code: "E0202",
        severity: "error",
        message: `duplicate identifier \`${businessObject.id}\` (already used by an element)`,
        span: businessObject.idSpan,
        help: "business objects share the flat ID namespace (decision D1)",
      });
    }
    if (!previous) declaredIds.set(businessObject.id, businessObject);
  }

  const carried = new Set<string>();
  for (const flow of model.flows) {
    for (const objectRef of flow.objects ?? []) {
      if (declaredIds.has(objectRef.id)) {
        carried.add(objectRef.id);
        continue;
      }
      const suggestion = nearest(objectRef.id, [...declaredIds.keys()]);
      diagnostics.push({
        code: "E0221",
        severity: "error",
        message: `unknown business-object reference \`${objectRef.id}\``,
        span: objectRef.span,
        help: suggestion
          ? `did you mean \`${suggestion}\`?`
          : "declare it: `business-object " + objectRef.id + ' "Name" "description"`',
      });
    }
  }

  for (const businessObject of model.businessObjects) {
    if (!carried.has(businessObject.id)) {
      diagnostics.push({
        code: "W0530",
        severity: "warning",
        message: `business object \`${businessObject.id}\` is never carried by any flow`,
        span: businessObject.idSpan,
        note: `completeness check of the \`${view.name}\` view`,
      });
    }
  }
  return diagnostics;
}

function checkMinimumCounts(elements: Element[], model: Model, view: View): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const rule of view.minCounts) {
    const declared = elements.filter((element) => element.kind === rule.kind).length;
    if (declared < rule.min) {
      diagnostics.push({
        code: rule.code,
        severity: "warning",
        message: rule.message,
        span: model.typeSpan ?? { line: 1, col: 1, len: 7 },
        note: `completeness check of the \`${view.name}\` view`,
      });
    }
  }
  return diagnostics;
}

function checkIsolatedElements(model: Model, view: View, elements: Element[]): Diagnostic[] {
  if (!view.isolatedWarn) return [];
  const diagnostics: Diagnostic[] = [];

  const connected = new Set<string>();
  const markConnected = (id: string) => {
    const element = model.index.get(id);
    if (!element) return;
    for (const subtreeId of subtreeIds(element)) connected.add(subtreeId);
    for (let ancestor = element.parent; ancestor; ancestor = ancestor.parent)
      connected.add(ancestor.id);
  };
  for (const flow of model.flows) {
    markConnected(flow.from);
    markConnected(flow.to);
  }

  for (const element of elements) {
    if (view.isolatedWarn.kinds.includes(element.kind) && !connected.has(element.id)) {
      diagnostics.push({
        code: view.isolatedWarn.code,
        severity: "warning",
        message: view.isolatedWarn.message + ` (\`${element.id}\`)`,
        span: element.idSpan,
        note: `completeness check of the \`${view.name}\` view`,
      });
    }
  }
  return diagnostics;
}

function nearest(word: string, candidates: string[]): string | undefined {
  let best: string | undefined,
    bestDistance = 3;
  for (const candidate of candidates) {
    const distance = editDistance(word.toLowerCase(), candidate.toLowerCase(), bestDistance);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/** Levenshtein edit distance, capped at `cap` for early exit. */
function editDistance(wordA: string, wordB: string, cap: number): number {
  if (Math.abs(wordA.length - wordB.length) > cap) return cap + 1;
  const distances = Array.from({ length: wordA.length + 1 }, (_, index) => index);
  for (let col = 1; col <= wordB.length; col++) {
    let prev = distances[0];
    distances[0] = col;
    for (let row = 1; row <= wordA.length; row++) {
      const above = distances[row];
      distances[row] = Math.min(
        distances[row] + 1,
        distances[row - 1] + 1,
        prev + (wordA[row - 1] === wordB[col - 1] ? 0 : 1),
      );
      prev = above;
    }
  }
  return distances[wordA.length];
}
