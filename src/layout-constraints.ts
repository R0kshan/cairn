/**
 * Resolves the `layout { … }` block into a rank per element — the single
 * implementation shared by the two stages that need it, so the diagnostics a
 * user reads and the order the layout applies can never disagree.
 *
 * - `validator.ts` reports the `problems` (`E0230`–`E0232`) and ignores the ranks.
 * - `scene-layout.ts` consumes the ranks and ignores the problems.
 *
 * A rank orders a **top-level** element against the other top-level elements.
 * Elements inside a container cannot be ordered at all, and saying so (`E0234`)
 * is deliberate rather than a gap: under `hierarchyHandling: INCLUDE_CHILDREN`,
 * elk decides an in-container position from the *edge* declaration order, and
 * every option that claims otherwise was measured — `partitioning.partition`,
 * `layerChoiceConstraint`, `layerConstraint: FIRST|LAST` and `position` with
 * `semiInteractive` are no-ops there, `position` with `crossingMinimization:
 * INTERACTIVE` raises `UnsupportedGraphException`, and reordering the children
 * array is silently overruled. The only lever left is reordering the global edge
 * list, which reshapes the whole drawing to serve one container. A keyword that
 * quietly did something other than what it says is worse than one that refuses.
 *
 * When nothing is ranked the result is empty, which is what keeps a diagram with
 * no `layout` block byte-identical to one from before this feature existed.
 */

import type { LayoutConstraint, Model, Span } from "./models/ast.ts";

/** A defect in the constraint set, in the shape `validator.ts` turns into a `Diagnostic`. */
export interface ConstraintProblem {
  code: "E0230" | "E0231" | "E0232" | "E0234";
  span: Span;
  message: string;
  note?: string;
  help?: string;
}

/** The scope every root-level element shares. Elements inside a container have their parent's id. */
const ROOT_SCOPE = "";

export interface ResolvedLayout {
  /**
   * Element id → its step in the reading order, 0-based, and empty unless at
   * least one constraint applied. Elements no constraint separates share a
   * step, so an element nothing mentions keeps the position the engine chose
   * for it.
   */
  rankOf: Map<string, number>;
  problems: ConstraintProblem[];
}

/** `first` sits ahead of everything, `last` behind it, everything else between. */
const TIER = { first: 0, normal: 1, last: 2 } as const;

/** The parent an element is ranked against. */
function scopeOf(model: Model, id: string): string | undefined {
  const element = model.index.get(id);
  return element ? (element.parent?.id ?? ROOT_SCOPE) : undefined;
}

/**
 * The constraints that can be applied at all: those whose operands are
 * root-level siblings. Everything else is reported and dropped, never
 * half-applied — an unknown id (`E0230`), operands from two different parents
 * (`E0231`), or operands inside a container (`E0234`).
 */
function rootConstraints(model: Model, problems: ConstraintProblem[]): LayoutConstraint[] {
  const applicable: LayoutConstraint[] = [];
  for (const constraint of model.layout) {
    let scope: string | undefined;
    let rejected = false;
    for (const operand of constraint.operands) {
      const operandScope = scopeOf(model, operand.id);
      if (operandScope === undefined) {
        problems.push({
          code: "E0230",
          span: operand.span,
          message: `unknown reference \`${operand.id}\` in the layout block`,
          help: "placement constraints order elements that exist — declare it first",
        });
        rejected = true;
        continue;
      }
      if (scope === undefined) scope = operandScope;
      else if (scope !== operandScope) {
        problems.push({
          code: "E0231",
          span: operand.span,
          message: `\`${operand.id}\` is not a sibling of the other operands`,
          note: `it sits ${describeScope(operandScope)}; the others sit ${describeScope(scope)}`,
          help: "a placement constraint orders an element against its own siblings — split it into one entry per container",
        });
        rejected = true;
      }
    }
    if (rejected || scope === undefined) continue;
    if (scope !== ROOT_SCOPE) {
      problems.push({
        code: "E0234",
        span: constraint.span,
        message: `\`${constraint.operands[0].id}\` sits inside \`${scope}\`, so its position cannot be constrained`,
        note: "placement constraints apply to top-level elements only",
        help: "order the container itself, or promote these elements to the diagram root",
      });
      continue;
    }
    applicable.push(constraint);
  }
  return applicable;
}

const describeScope = (scope: string): string =>
  scope === ROOT_SCOPE ? "at the diagram root" : `inside \`${scope}\``;

/**
 * Merges the operands of every `same-rank` entry, so the ordering below runs
 * over *groups* of elements rather than elements. Returns the representative of
 * each element's group (a union-find `find`, fully path-compressed).
 */
function mergeSameRankGroups(constraints: LayoutConstraint[], members: string[]): Map<string, string> {
  const parent = new Map(members.map((id) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    for (let step = id; step !== root; ) {
      const next = parent.get(step)!;
      parent.set(step, root);
      step = next;
    }
    return root;
  };
  for (const constraint of constraints) {
    if (constraint.kind !== "same-rank") continue;
    const [head, ...rest] = constraint.operands;
    for (const operand of rest) parent.set(find(operand.id), find(head.id));
  }
  return new Map(members.map((id) => [id, find(id)]));
}

/**
 * Every `first`/`last` pin, in source order. A list rather than a map keyed by
 * element: `first X` followed by `last X` is a contradiction, and a map would
 * silently keep only the second.
 */
function tierPinsOf(constraints: LayoutConstraint[]): { id: string; tier: number; span: Span }[] {
  const pins: { id: string; tier: number; span: Span }[] = [];
  for (const constraint of constraints) {
    if (constraint.kind !== "first" && constraint.kind !== "last") continue;
    const tier = constraint.kind === "first" ? TIER.first : TIER.last;
    for (const operand of constraint.operands)
      pins.push({ id: operand.id, tier, span: constraint.span });
  }
  return pins;
}

/**
 * The reading-order level of every group, or `undefined` when the constraints
 * contradict each other — in which case the caller drops them all, because a
 * half-applied contradiction has no defined result.
 *
 * A *level*, not a position in a queue. Groups nothing orders relative to each
 * other share a level, so an entry does only what it says: `before A B` moves B
 * behind A and leaves C exactly where the engine had it. Ranking every element
 * into a distinct slot instead — with declaration order as the tie-break — made
 * one `same-rank` entry silently serialise a whole diagram.
 */
function levelGroups(
  constraints: LayoutConstraint[],
  members: string[],
  groupOf: Map<string, string>,
  problems: ConstraintProblem[],
): Map<string, number> | undefined {
  const declarationIndex = new Map(members.map((id, index) => [id, index]));
  const groups = members.filter((id) => groupOf.get(id) === id);

  const contradiction = (span: Span, message: string, note?: string): undefined => {
    problems.push({
      code: "E0232",
      span,
      message,
      note,
      help: "remove one of the conflicting entries — the whole layout block is ignored for this container until they agree",
    });
    return undefined;
  };

  const tierByGroup = new Map<string, number>(groups.map((group) => [group, TIER.normal]));
  const pinnedBy = new Map<string, string>();
  for (const pin of tierPinsOf(constraints)) {
    const group = groupOf.get(pin.id);
    if (group === undefined) continue;
    const current = tierByGroup.get(group)!;
    if (current !== TIER.normal && current !== pin.tier)
      return contradiction(
        pin.span,
        `\`${pin.id}\` cannot be placed ${pin.tier === TIER.first ? "first" : "last"}`,
        `\`${pinnedBy.get(group)}\` is already pinned the other way, and they share a rank`,
      );
    tierByGroup.set(group, pin.tier);
    pinnedBy.set(group, pin.id);
  }

  const successors = new Map(groups.map((group) => [group, [] as string[]]));
  const incoming = new Map(groups.map((group) => [group, 0]));
  for (const constraint of constraints) {
    if (constraint.kind !== "before") continue;
    const [earlier, later] = constraint.operands;
    const earlierGroup = groupOf.get(earlier.id)!;
    const laterGroup = groupOf.get(later.id)!;
    if (earlierGroup === laterGroup)
      return contradiction(
        constraint.span,
        `\`${earlier.id}\` cannot come before \`${later.id}\``,
        "a `same-rank` entry already places them together",
      );
    if (tierByGroup.get(earlierGroup)! > tierByGroup.get(laterGroup)!)
      return contradiction(
        constraint.span,
        `\`${earlier.id}\` cannot come before \`${later.id}\``,
        "a `first`/`last` entry already places them the other way round",
      );
    successors.get(earlierGroup)!.push(laterGroup);
    incoming.set(laterGroup, incoming.get(laterGroup)! + 1);
  }

  // Kahn's algorithm, taking the ready group declared earliest so a diagram
  // resolves the same way every run. A group's level is one past its deepest
  // predecessor — the longest `before` chain reaching it.
  const level = new Map(groups.map((group) => [group, 0]));
  const ready = groups.filter((group) => incoming.get(group) === 0);
  let settled = 0;
  while (ready.length) {
    ready.sort((a, b) => declarationIndex.get(a)! - declarationIndex.get(b)!);
    const group = ready.shift()!;
    settled++;
    for (const successor of successors.get(group)!) {
      level.set(successor, Math.max(level.get(successor)!, level.get(group)! + 1));
      const remaining = incoming.get(successor)! - 1;
      incoming.set(successor, remaining);
      if (remaining === 0) ready.push(successor);
    }
  }
  if (settled !== groups.length) {
    const cycle = groups.filter((group) => incoming.get(group)! > 0);
    return contradiction(
      constraints.find((constraint) => constraint.kind === "before")!.span,
      "placement constraints contradict each other",
      `following them leads back to the start: ${cycle.join(", ")}`,
    );
  }

  // `first`/`last` move a whole tier clear of the middle one, far enough that no
  // `before` chain can reach across. Shifting rather than flattening keeps the
  // chains *inside* a tier intact — `first A` with `before A B` still orders the
  // two, it just puts both ahead of everything unpinned.
  const tierShift = groups.length + 1;
  for (const group of groups)
    level.set(group, level.get(group)! + (tierByGroup.get(group)! - TIER.normal) * tierShift);

  const lowest = Math.min(...level.values());
  return new Map([...level].map(([group, value]) => [group, value - lowest]));
}

export function resolveLayoutConstraints(model: Model): ResolvedLayout {
  const problems: ConstraintProblem[] = [];
  const rankOf = new Map<string, number>();
  if (!model.layout.length) return { rankOf, problems };

  const constraints = rootConstraints(model, problems);
  if (!constraints.length) return { rankOf, problems };

  const members = model.elements.map((element) => element.id);
  const groupOf = mergeSameRankGroups(constraints, members);
  const levels = levelGroups(constraints, members, groupOf, problems);
  if (!levels) return { rankOf, problems };

  for (const id of members) rankOf.set(id, levels.get(groupOf.get(id)!)!);
  return { rankOf, problems };
}
