/**
 * Core AST and model types shared across the whole pipeline: source spans,
 * elements, flows, business objects, the assembled `Model`, and the
 * `DiagramStyle` with its `defaultDiagramStyle()` factory. Also holds the
 * `explanations` registry backing `cairn explain <code>`. Pure types and data —
 * no logic — so every stage can depend on it without cycles.
 */

export interface Span {
  line: number;
  col: number;
  len: number;
}

export interface StyleProps {
  fill?: string;
  stroke?: {
    color?: string;
    style?: "solid" | "dashed" | "dotted";
    width?: number;
  };
  text?: string;
  label?: "on-line" | "above" | "below";
  font?: { family?: string; size?: number };
}

export type Disposition = "wide" | "tall" | "slide" | "page";

export interface DiagramStyle {
  crossingHops: boolean;
  compact: boolean;
  disposition: Disposition;
  legend: "auto" | "off";
  flowText: "full" | "numbered";
  arrows: "normal" | "large";
  flowColor: "none" | "by-source";
  flowLabel: "on-line" | "above" | "below";
  flowStroke: {
    color: string;
    style: "solid" | "dashed" | "dotted";
    width: number;
  };
  flowStrokeColorSet: boolean;
  theme: string;
  accent?: string;
  background?: string;
  lang: "en" | "fr";
  kind: Record<string, StyleProps>;
  font: { family: string; size: number };
}

export interface Element {
  kind: string;
  kindSpan: Span;
  id: string;
  idSpan: Span;
  label?: string;
  attr?: { value: string; span: Span };
  parent?: Element;
  children: Element[];
  style?: StyleProps;
  /**
   * Author-declared placement preference inside the element's layout partition
   * (`order: 2`). Opt-in: an element without one stays wherever the layout
   * engine puts it, so a diagram that declares no order renders unchanged.
   */
  order?: { value: number; span: Span };
}

/**
 * Which side of an element a flow attaches to, named as the diagram is *read*
 * (`APP.right -> DB.left`). Absolute, not relative to the flow's direction.
 */
export type AttachSide = "left" | "right" | "top" | "bottom";

export const ATTACH_SIDES: AttachSide[] = ["left", "right", "top", "bottom"];

export interface Flow {
  id: string;
  from: string;
  fromSpan: Span;
  /** Author-declared attachment side on the source element, if any. */
  fromSide?: { value: AttachSide; span: Span };
  to: string;
  toSpan: Span;
  /** Author-declared attachment side on the target element, if any. */
  toSide?: { value: AttachSide; span: Span };
  /**
   * Line style carried by the arrow glyph: `->` leaves it unset (solid, the
   * default), `-->` is dashed, `..>` dotted. An inline `{ stroke: … }` is more
   * specific and wins; the glyph in turn beats the diagram's `flow-stroke`.
   */
  lineStyle?: "dashed" | "dotted";
  label?: string;
  tech?: { protocol?: string; format?: string; span: Span };
  objects?: { id: string; span: Span }[];
  span: Span;
  style?: StyleProps;
}

export interface BusinessObject {
  id: string;
  idSpan: Span;
  name: string;
  description?: string;
}

/**
 * One entry of the `layout { … }` block — an author's statement about reading
 * order, not about coordinates.
 *
 * `after A B` is parsed as `before B A`: the two say the same thing, and keeping
 * one kind means the resolver has one edge direction to reason about rather than
 * two that must agree.
 */
export interface LayoutConstraint {
  kind: "first" | "last" | "before" | "same-rank";
  operands: { id: string; span: Span }[];
  /** The whole entry, for the diagnostic that rejects it as a contradiction. */
  span: Span;
}

export interface Model {
  type?: string;
  typeSpan?: Span;
  title?: string;
  elements: Element[];
  flows: Flow[];
  businessObjects: BusinessObject[];
  legendNotes: string[];
  /**
   * The `layout { … }` block's entries, in source order. Empty for a diagram
   * that declares none, which is what keeps such a diagram rendering exactly as
   * it did before the block existed (INVARIANTS §17).
   */
  layout: LayoutConstraint[];
  style: DiagramStyle;
  index: Map<string, Element>;
}

export const defaultDiagramStyle = (): DiagramStyle => ({
  crossingHops: true,
  compact: false,
  disposition: "wide",
  legend: "auto",
  flowText: "full",
  arrows: "normal",
  flowColor: "none",
  flowLabel: "on-line",
  flowStroke: { color: "#444444", style: "solid", width: 1.3 },
  flowStrokeColorSet: false,
  theme: "light",
  lang: "en",
  kind: {},
  font: { family: "Helvetica", size: 12.5 },
});

export const explanations: Record<string, string> = {
  E0101: "Syntax error: the file does not follow the DSL grammar.",
  E0106:
    "`order:` takes a whole number ≥ 0. It is a placement preference inside the element's layout partition — lower comes first in reading order (left to right for `wide`/`slide`, top to bottom for `tall`/`page`). Values need not be contiguous, and elements without an `order` stay wherever the layout engine puts them.",
  E0201:
    "Unknown element kind for the active view. Each view defines its own kinds (e.g. logical: actor-group, actor, system, layer, block, external).",
  E0202:
    "Duplicate identifier. IDs are flat and unique per file (decision D1): every element needs a distinct ID so flows can reference it unambiguously.",
  E0203:
    "The logical view forbids unlabelled arrows: every flow must name the data, command or event it carries. A logical diagram tells what circulates, not just who talks to whom.",
  E0210:
    'No functional block may sit "bare" at the diagram root: it always lives inside a layer, a system or an external system (principle: no floating blocks).',
  E0211:
    "Actors are grouped by role inside actor-groups (reading convention: actor groups sit at the diagram edges).",
  E0212: "A layer materializes an internal level of a system: it must be nested inside a system.",
  E0220: "Unknown reference: the flow points to an ID that does not exist in this file.",
  W0502:
    'Every element should carry a human-readable label — without one, its technical ID is displayed on the diagram. Write `actor ACT1 "Readable name"`.',
  W0501:
    "Completeness check: a logical diagram without actors does not show who triggers or consumes the functions. Add the actors, or ignore this warning if the diagram is intentionally partial.",
  W0510:
    "Completeness check: an element with no flow at all is either useless in this view, or waiting for its flows to be documented.",
  W0520:
    "Slide/page capacity check: after scale-to-fit on the physical target (1280\u00d7720 slide or A4 page), label text would render below ~7px, which is unreadable when projected or printed. No layout can fix a diagram that carries more content than the medium can show — split the view into sub-diagrams (e.g. one per system), or use `wide`/`tall` for full-screen and print use.",
  E0213:
    "Application modules always live inside an application container (application-view convention: applications decompose into modules).",
  E0214:
    "Servers always live inside a network zone or a site — a machine without a network location cannot be secured or reached.",
  E0215:
    "A deployed application (app-instance) must sit on a server or in a zone. It shows WHERE an application runs, without its internal detail (C4 deployment convention).",
  E0216:
    "Network zones belong to a site (or nest inside a larger zone): DMZ and LAN only mean something relative to a perimeter.",
  W0540:
    'C4 container-diagram practice: inter-process relationships should be labelled with their technology/protocol ("the how, not just the what"). Human/actor interactions are exempt. Add `(API_REST, JSON)` after the label, or ignore if the diagram is intentionally functional-only.',
  E0223:
    "Unknown attachment side. A flow endpoint may name the side it attaches to — `APP.right -> DB.left` — using the diagram as it is read: `left`, `right`, `top`, `bottom`. The side is a hint, not a guarantee: a side the layout cannot reach is dropped with a W0570 warning rather than forced.",
  E0240:
    "The infrastructure view requires every flow to carry its protocol (and port if relevant): the flow matrix is the primary output of this view. Add `(HTTPS/443)` after the label.",
  E0221:
    'Unknown business-object reference: a flow carries `[AN_ID]` that no `business-object` declaration defines. Declare it once (`business-object ID "Name" "description"`) so the registry and the chips stay consistent.',
  E0222:
    "Business objects are a logical-view concept (what data circulates between functional blocks). They are not part of the application, infrastructure, or security views — model the exchange with the flow label and technical tail instead. Remove the `business-object` declaration and its `[refs]`, or switch the diagram to `logical`.",
  W0530:
    "Completeness check: a declared business object is never carried by any flow — either connect it to the flows that transport it, or remove it from this view.",
  E0217:
    "A sensitive asset must sit inside a trust zone: its protection level is defined by the zone that contains it.",
  E0218:
    "A security node (firewall, WAF, bastion, reverse proxy) lives inside a trust zone — typically the exposed zone whose traffic it filters.",
  E0250:
    'The security view requires each trust zone to declare a sensitivity level in parentheses after the label: `trust-zone DMZ "DMZ" (public)`. Levels, least \u2192 most trusted: public, internal, restricted, secret. The level drives the zone color and the trust-boundary crossing checks.',
  W0570:
    "A declared attachment side (`APP.right -> DB.left`) did not survive layout: the flow ended up on another side of the element. Pins are honored where the layout can reach them and dropped where it cannot, rather than forced into an unreadable route. Move the element instead (`order:`), pin the other endpoint, or drop the pin.",
  W0571:
    "An endpoint reads `ID.side`, but `ID.side` is itself a declared element, and a declared id always wins — so the flow attaches to that element and no side is pinned. Rename the element if you meant the side.",
  E0230:
    "Unknown reference in the `layout` block: a placement constraint names an element that no declaration defines. Declare the element first — the constraint orders elements that exist.",
  E0231:
    "A placement constraint mixes elements from different containers. Reading order is decided among siblings, so an entry may only name elements that share a parent — split it into one entry per container.",
  E0232:
    "The `layout` block contradicts itself: following its entries leads back to the start, or pins one element both first and last. There is no order satisfying all of them, so the whole block is ignored for that container until they agree — remove one of the conflicting entries.",
  E0234:
    "A placement constraint names an element inside a container. Only top-level elements can be ordered: under elk's `INCLUDE_CHILDREN` hierarchy handling, a child's position comes from the edge declaration order, and every option that claims otherwise is a no-op there. Order the container itself, or promote the elements to the diagram root.",
  W0560:
    "Security check: this flow enters a more-trusted zone from a less-trusted one without passing through a security-node (firewall/WAF/bastion). Route it through a filtering point, or confirm the direct path is deliberate. This is the diagram equivalent of a missing firewall rule review.",
  W0561:
    "Security check: an inter-zone flow does not state its encryption/protocol. Cross-zone traffic should declare how it is protected: add `(TLS1.3)` or the relevant protocol after the label.",
};
