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
  parent?: Element;
  children: Element[];
  style?: StyleProps;
  /**
   * Author-declared placement preference inside the element's layout partition
   * (`order: 2`). Opt-in: an element without one stays wherever the layout
   * engine puts it, so a diagram that declares no order renders unchanged.
   */
  order?: { value: number; span: Span };
  /**
   * Tech-stack logo drawn in the element's corner (`logo: react`, or
   * `logo: "./logos/acme.svg"` for a file). `source` records which of the two
   * the author wrote, because a bare name resolves against the built-in set
   * while a quoted one is a path the CLI reads and inlines — the core never
   * touches the filesystem. Opt-in: an element without one renders unchanged.
   */
  logo?: { value: string; source: "builtin" | "file"; span: Span };
}

/**
 * Which side of an element a flow attaches to, named as the diagram is *read*
 * (`APP.right -> DB.left`). Absolute, not relative to the flow's direction.
 */
export type AttachSide = "left" | "right" | "top" | "bottom";

/** All possible attachment sides for flow endpoints. */
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

export interface Model {
  type?: string;
  typeSpan?: Span;
  title?: string;
  elements: Element[];
  flows: Flow[];
  businessObjects: BusinessObject[];
  legendNotes: string[];
  style: DiagramStyle;
  index: Map<string, Element>;
}

/** Creates a default diagram style with standard settings. */
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

/** Registry of diagnostic code explanations for the `cairn explain` command. */
export const explanations: Record<string, string> = {
  E0101: "Syntax error: the file does not follow the DSL grammar.",
  E0105:
    '`logo:` takes either a built-in name (`logo: react`) or a quoted path to a file in the workspace (`logo: "./logos/acme.svg"`). A URL is refused on purpose: a diagram that fetches its logos stops being self-contained, leaks the reader\'s IP to whoever hosts them, and rots silently when the address dies — so cairn inlines a file instead of linking one.',
  E0106:
    "`order:` takes a whole number ≥ 0. On a top-level element it sets the reading order the disposition defines — left to right for `wide`/`slide`, top to bottom for `tall`/`page` — by banding the element inside its own layout partition, so it never crosses into another partition. Inside a container the axis flips: a child's layer belongs to the flows and elk honors no constraint that would change it, so there `order:` sorts the siblings that share a layer. Values need not be contiguous.",
  E0107:
    'Unknown built-in logo. The built-in set is deliberately small — it covers common stack technologies, not every brand. Anything outside it is still reachable as a workspace file: `logo: "./logos/name.svg"`.',
  E0108:
    "This element kind does not carry a logo. A logo marks what a piece of software is built with, so the kinds that accept one are the kinds that run code; actors are people and containers are groupings, so neither takes one.",
  W0580:
    "A `logo:` file could not be inlined — it is missing, too large, or not one of the supported types. Only a warning: the diagram is still valid and renders without the mark, because a decoration that failed to load is no reason to fail a build.",
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
    "Business objects are a logical-view concept (what data circulates between functional blocks). They are not part of the application or infrastructure views — model the exchange with the flow label and technical tail instead. Remove the `business-object` declaration and its `[refs]`, or switch the diagram to `logical`.",
  W0530:
    "Completeness check: a declared business object is never carried by any flow — either connect it to the flows that transport it, or remove it from this view.",
  W0570:
    "A declared attachment side (`APP.right -> DB.left`) did not survive layout: the flow ended up on another side of the element. Pins are honored where the layout can reach them and dropped where it cannot, rather than forced into an unreadable route. Move the element instead (`order:`), pin the other endpoint, or drop the pin.",
  W0571:
    "An endpoint reads `ID.side`, but `ID.side` is itself a declared element, and a declared id always wins — so the flow attaches to that element and no side is pinned. Rename the element if you meant the side.",
};
