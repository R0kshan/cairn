// Core model types. Every AST node carries a source span for diagnostics.

export interface Span { line: number; col: number; len: number; }

export interface StyleProps {
  fill?: string;
  stroke?: { color?: string; style?: 'solid' | 'dashed' | 'dotted'; width?: number };
  text?: string;   // label/text color (per element or per kind)
  label?: 'on-line' | 'above' | 'below';
  font?: { family?: string; size?: number };
}

export type Disposition = 'wide' | 'tall' | 'slide' | 'page';

export interface DiagramStyle {
  crossingHops: boolean;
  compact: boolean;                // tighter spacing + narrower-wrapped flow labels
  disposition: Disposition;
  legend: 'auto' | 'off';
  flowText: 'full' | 'numbered';   // numbered: arrows carry a number badge, text goes to the FLUX band
  flowLabel: 'on-line' | 'above' | 'below';
  flowStroke: { color: string; style: 'solid' | 'dashed' | 'dotted'; width: number };
  flowStrokeColorSet: boolean;     // true once the author sets a flow-stroke color (else palette edge color)
  theme: 'light' | 'dark';         // selects the default palette + per-kind defaults
  background?: string;             // canvas background override (else palette background)
  lang: 'en' | 'fr';               // output language for rendered chrome (keywords stay English — decision D2)
  kind: Record<string, StyleProps>; // per element kind overrides
  font: { family: string; size: number };
}

export interface Element {
  kind: string;
  kindSpan: Span;
  id: string;
  idSpan: Span;
  label?: string;
  attr?: { value: string; span: Span };  // optional `(value)` after the label — e.g. trust-zone sensitivity level
  parent?: Element;
  children: Element[];
  style?: StyleProps;
}

export interface Flow {
  id: string;              // synthetic F01..
  from: string; fromSpan: Span;
  to: string; toSpan: Span;
  label?: string;
  tech?: { protocol?: string; format?: string; span: Span }; // (SFTP, XML) tail
  objects?: { id: string; span: Span }[];  // business objects carried by the flow
  span: Span;              // whole statement (for E0203)
  style?: StyleProps;
}

export interface BusinessObject {
  id: string; idSpan: Span;
  name: string;
  description?: string;
}

export interface Model {
  type?: string;           // diagram type header (logical | application | infrastructure | security)
  typeSpan?: Span;
  title?: string;
  elements: Element[];     // root elements
  flows: Flow[];
  businessObjects: BusinessObject[];
  legendNotes: string[];   // free entries from the `legend { note "…" }` block
  style: DiagramStyle;
  index: Map<string, Element>; // flat id index
}

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  span: Span;
  note?: string;
  help?: string;
  fix?: { insert: string; atEndOfLine?: boolean };
}

export const defaultDiagramStyle = (): DiagramStyle => ({
  crossingHops: true,
  compact: false,
  disposition: 'wide',
  legend: 'auto',
  flowText: 'full',
  flowLabel: 'on-line',
  flowStroke: { color: '#444444', style: 'solid', width: 1.3 },
  flowStrokeColorSet: false,
  theme: 'light',
  lang: 'en',
  kind: {},
  font: { family: 'Helvetica', size: 11 },
});

// ---------------- UI strings (output localization) ----------------
// `lang` localizes rendered chrome only — band titles, the legend flow line,
// the matrice-des-flux headers. DSL keywords stay English (decision D2), so
// source files remain portable and diff-clean; only the artifact changes.
export interface UIStrings {
  flows: string; objects: string; legend: string;
  numberedSuffix: string; carriedByFlow: string; businessObject: string;
  matrix: { title: string; n: string; source: string; dest: string; proto: string; port: string; nature: string; zone: string };
}
export const UI: Record<'en' | 'fr', UIStrings> = {
  en: {
    flows: 'FLOWS', objects: 'BUSINESS OBJECTS', legend: 'LEGEND',
    numberedSuffix: 'numbered (text: FLOWS band)', carriedByFlow: 'carried by the flow', businessObject: 'Business object',
    matrix: { title: 'TECHNICAL FLOW MATRIX', n: 'No.', source: 'Source', dest: 'Destination', proto: 'Protocol', port: 'Port', nature: 'Flow', zone: 'zone' },
  },
  fr: {
    flows: 'FLUX', objects: 'OBJETS MÉTIER', legend: 'LÉGENDE',
    numberedSuffix: 'numéroté (texte : bande FLUX)', carriedByFlow: 'porté par le flux', businessObject: 'Objet métier',
    matrix: { title: 'MATRICE DES FLUX TECHNIQUES', n: 'N°', source: 'Source', dest: 'Destination', proto: 'Protocole', port: 'Port', nature: 'Nature du flux', zone: 'zone' },
  },
};

// ---------------- Palettes ----------------
// The renderer's "chrome" colors (text, dividers, chips, halos, fallbacks) come
// from a palette selected by the diagram theme. `light` reproduces the original
// hardcoded values exactly (so light-mode output is byte-identical); `dark` is
// the tuned dark-mode range. Per-kind element fills/strokes come from the
// view's `defaults` (light) / `defaultsDark` (dark).
export interface Palette {
  background: string;
  containerLabel: string;
  containerFill: string; containerStroke: string;
  nodeText: string;
  nodeFill: string; nodeStroke: string;
  actorStroke: string; actorText: string;
  edge: string;
  edgeLabel: string; techText: string;
  halo: string;
  bandTitle: string; bandText: string; bandMuted: string; divider: string;
  badgeFill: string; badgeStroke: string;
  chipFill: string; chipStroke: string; chipText: string;
}

export const lightPalette: Palette = {
  background: 'white',
  containerLabel: '#333',
  containerFill: '#f7f7f7', containerStroke: '#999',
  nodeText: '#222233',
  nodeFill: 'white', nodeStroke: '#667',
  actorStroke: '#445566', actorText: '#223344',
  edge: '#444444',
  edgeLabel: '#333', techText: '#777',
  halo: 'white',
  bandTitle: '#555', bandText: '#444', bandMuted: '#666', divider: '#ddd',
  badgeFill: 'white', badgeStroke: '#888',
  chipFill: '#fdf3d8', chipStroke: '#c9a227', chipText: '#7a6216',
};

export const darkPalette: Palette = {
  background: '#1e2227',
  containerLabel: '#e6edf3',
  containerFill: '#2a2f37', containerStroke: '#4a5560',
  nodeText: '#e6edf3',
  nodeFill: '#252a31', nodeStroke: '#5a6673',
  actorStroke: '#8aa0b8', actorText: '#c9d5e1',
  edge: '#9aa7b4',
  edgeLabel: '#d6dde4', techText: '#9aa7b4',
  halo: '#1e2227',
  bandTitle: '#b7c2cd', bandText: '#c2ccd6', bandMuted: '#93a0ab', divider: '#3a4149',
  badgeFill: '#252a31', badgeStroke: '#5a6673',
  chipFill: '#3a3320', chipStroke: '#b08d2a', chipText: '#e0c068',
};

export const palettes: Record<string, Palette> = { light: lightPalette, dark: darkPalette };

// ---------------- Views ----------------

export interface NestingRule { code: string; child: string; parents: string[]; message: string; help: string; }
export interface View {
  name: string;
  kinds: string[];
  containerKinds: string[];
  legendNames: Record<string, string>;  // kind -> display name in the auto legend
  legendNamesFr: Record<string, string>; // kind -> French display name (lang: fr)
  bandTitles: { flows: string; objects: string; legend: string };
  partitions: Record<string, number>;    // semantic bands, left -> right
  partitionByOrder?: boolean;            // infra: root elements band in declaration order
  // Views without an actor-group container (infrastructure) model their users as
  // standalone `actor` elements. When set, the legend renders a person-glyph key
  // for them (in grouped views the "Actor group" swatch already keys the actors).
  actorLegend?: boolean;
  legendFlowLabel: string;
  legendFlowLabelFr: string;
  flowLabelRequired: { code: string; message: string; help: string } | null;
  flowTechRequired: { code: string; message: string; help: string } | null;
  flowTechRecommended: { code: string; message: string; help: string } | null; // warning, skips actor flows
  nesting: NestingRule[];
  minCounts: { code: string; kind: string; min: number; message: string }[];
  isolatedWarn: { code: string; kinds: string[]; message: string } | null;
  defaults: Record<string, StyleProps>;      // per-kind visual defaults (light theme)
  defaultsDark: Record<string, StyleProps>;  // per-kind visual defaults (dark theme)
  // --- security view extras (optional) ---
  // An element attribute `(value)` restricted to a kind, e.g. trust-zone sensitivity.
  attrSpec?: { kind: string; values: string[]; code: string; message: string; help: string };
  // Trust ordering (least → most trusted) used by the boundary-crossing lint.
  trustOrder?: Record<string, number>;
  // Flags a flow entering a higher-trust zone that doesn't pass a `security-node`.
  boundaryLint?: { code: string; nodeKind: string; message: string; help: string };
  // Recommends a protocol/encryption tail on cross-zone flows.
  crossZoneTechRecommended?: { code: string; message: string; help: string };
  // Per-sensitivity-level container colors (keyed by attr value) — light / dark.
  levelDefaults?: Record<string, StyleProps>;
  levelDefaultsDark?: Record<string, StyleProps>;
}

export const logicalView: View = {
  name: 'logical',
  kinds: ['actor-group', 'actor', 'system', 'layer', 'block', 'external'],
  containerKinds: ['actor-group', 'system', 'layer', 'external'],
  legendNames: {
    'actor-group': 'Actor group', actor: 'Actor', system: 'System',
    layer: 'Layer', block: 'Functional block', external: 'External system',
  },
  legendNamesFr: {
    'actor-group': "Groupe d'acteurs", actor: 'Acteur', system: 'Système',
    layer: 'Couche', block: 'Bloc fonctionnel', external: 'Système externe',
  },
  bandTitles: { flows: 'FLOWS', objects: 'BUSINESS OBJECTS', legend: 'LEGEND' },
  legendFlowLabel: 'Functional flow (label = exchanged data)',
  legendFlowLabelFr: 'Flux fonctionnel (libellé = données échangées)',
  flowTechRequired: null,
  flowTechRecommended: null,
  partitions: { 'actor-group': 0, system: 1, external: 2 },
  flowLabelRequired: {
    code: 'E0203',
    message: 'flow without a label',
    help: 'add a label describing the exchanged data: `A -> B : "…"`',
  },
  nesting: [
    { code: 'E0210', child: 'block', parents: ['layer', 'system', 'external'],
      message: 'functional block outside any system',
      help: 'move this `block` inside a `layer`, `system` or `external`' },
    { code: 'E0211', child: 'actor', parents: ['actor-group'],
      message: 'actor outside any group',
      help: 'move this `actor` inside an `actor-group`' },
    { code: 'E0212', child: 'layer', parents: ['system'],
      message: 'layer outside any system',
      help: 'move this `layer` inside a `system`' },
  ],
  minCounts: [
    { code: 'W0501', kind: 'actor', min: 1, message: 'no actor declared' },
  ],
  isolatedWarn: {
    code: 'W0510', kinds: ['block'],
    message: 'isolated element: no incoming or outgoing flow',
  },
  defaults: {
    'actor-group': { fill: '#eef4fb', stroke: { color: '#7a9cc4', style: 'dashed', width: 1.2 } },
    system: { fill: '#f6f2ea', stroke: { color: '#b09a6d', style: 'solid', width: 1.2 } },
    layer: { fill: '#fdfbf6', stroke: { color: '#c4b258', style: 'solid', width: 1 } },
    external: { fill: '#f0eef5', stroke: { color: '#9187b3', style: 'dashed', width: 1.2 } },
    block: { fill: '#ffffff', stroke: { color: '#666677', style: 'solid', width: 1.3 } },
    actor: {},
  },
  defaultsDark: {
    'actor-group': { fill: '#232a33', stroke: { color: '#5c7fa8', style: 'dashed', width: 1.2 } },
    system: { fill: '#2b2822', stroke: { color: '#9c8558', style: 'solid', width: 1.2 } },
    layer: { fill: '#26241d', stroke: { color: '#a89446', style: 'solid', width: 1 } },
    external: { fill: '#2a2833', stroke: { color: '#7d72a0', style: 'dashed', width: 1.2 } },
    block: { fill: '#252a31', stroke: { color: '#7c8894', style: 'solid', width: 1.3 } },
    actor: {},
  },
};

export const applicationView: View = {
  name: 'application',
  kinds: ['actor-group', 'actor', 'application', 'module', 'datastore', 'external'],
  containerKinds: ['actor-group', 'application', 'external'],
  partitions: { 'actor-group': 0, application: 1, datastore: 1, external: 2 },
  legendNames: {
    'actor-group': 'Actor group', actor: 'Actor', application: 'Application',
    module: 'Application module', datastore: 'Datastore / registry', external: 'External system',
  },
  legendNamesFr: {
    'actor-group': "Groupe d'acteurs", actor: 'Acteur', application: 'Application',
    module: 'Module applicatif', datastore: 'Entrepôt / référentiel', external: 'Système externe',
  },
  bandTitles: { flows: 'FLOWS', objects: 'BUSINESS OBJECTS', legend: 'LEGEND' },
  legendFlowLabel: 'Application flow — (protocol, format) under the label',
  legendFlowLabelFr: 'Flux applicatif — (protocole, format) sous le libellé',
  flowLabelRequired: {
    code: 'E0203',
    message: 'flow without a label',
    help: 'add a label describing the exchange: `A -> B : "…" (HTTP, JSON)`',
  },
  flowTechRequired: null,
  // C4 container-diagram practice: inter-process relationships should carry
  // their technology/protocol. Warning (not error); human/actor flows exempt.
  flowTechRecommended: {
    code: 'W0540',
    message: 'system-to-system flow without protocol',
    help: 'add the technology: `A -> B : "…" (API_REST, JSON)` (C4 practice: label the how, not just the what)',
  },
  nesting: [
    { code: 'E0213', child: 'module', parents: ['application'],
      message: 'module outside any application',
      help: 'move this `module` inside an `application`' },
    { code: 'E0211', child: 'actor', parents: ['actor-group'],
      message: 'actor outside any group',
      help: 'move this `actor` inside an `actor-group`' },
  ],
  minCounts: [],
  isolatedWarn: {
    code: 'W0510', kinds: ['module', 'datastore'],
    message: 'isolated element: no incoming or outgoing flow',
  },
  defaults: {
    'actor-group': { fill: '#eef4fb', stroke: { color: '#7a9cc4', style: 'dashed', width: 1.2 } },
    application: { fill: '#e8f1f8', stroke: { color: '#5b8db8', style: 'solid', width: 1.2 } },
    module: { fill: '#ffffff', stroke: { color: '#5b7a99', style: 'solid', width: 1.3 } },
    datastore: { fill: '#f3eef8', stroke: { color: '#8a6fae', style: 'solid', width: 1.3 } },
    external: { fill: '#f0eef5', stroke: { color: '#9187b3', style: 'dashed', width: 1.2 } },
    actor: {},
  },
  defaultsDark: {
    'actor-group': { fill: '#232a33', stroke: { color: '#5c7fa8', style: 'dashed', width: 1.2 } },
    application: { fill: '#1f2a33', stroke: { color: '#4a7ba6', style: 'solid', width: 1.2 } },
    module: { fill: '#252a31', stroke: { color: '#5f7f9e', style: 'solid', width: 1.3 } },
    datastore: { fill: '#2a2433', stroke: { color: '#7a5f9e', style: 'solid', width: 1.3 } },
    external: { fill: '#2a2833', stroke: { color: '#7d72a0', style: 'dashed', width: 1.2 } },
    actor: {},
  },
};

export const infrastructureView: View = {
  name: 'infrastructure',
  // `actor` = the consumer/user of the infrastructure (C4 Person). It has no
  // network location, so it is not a container and needs no zone; it reads on
  // the entry edge, distinct from `external` third-party systems on the exit edge.
  kinds: ['actor', 'site', 'network-zone', 'server', 'app-instance', 'external'],
  containerKinds: ['site', 'network-zone', 'server'],
  partitions: { external: 2 },
  partitionByOrder: true, // zones/sites band left->right in declaration order
  actorLegend: true,      // users are standalone actors here — key them in the legend
  legendNames: {
    actor: 'User / consumer',
    site: 'Site / data center', 'network-zone': 'Network zone', server: 'Server / VM',
    'app-instance': 'Deployed application', external: 'External system',
  },
  legendNamesFr: {
    actor: 'Utilisateur / consommateur',
    site: 'Site / centre de données', 'network-zone': 'Zone réseau', server: 'Serveur / VM',
    'app-instance': 'Application déployée', external: 'Système externe',
  },
  bandTitles: { flows: 'FLOWS', objects: 'BUSINESS OBJECTS', legend: 'LEGEND' },
  legendFlowLabel: 'Technical flow (protocol, port)',
  legendFlowLabelFr: 'Flux technique (protocole, port)',
  flowLabelRequired: {
    code: 'E0203',
    message: 'flow without a label',
    help: 'add a label describing the exchange: `A -> B : "…" (HTTPS/443)`',
  },
  flowTechRecommended: null,
  flowTechRequired: {
    code: 'E0240',
    message: 'technical flow without protocol',
    help: 'the infrastructure view requires a protocol: `A -> B : "…" (HTTPS/443)`',
  },
  nesting: [
    { code: 'E0214', child: 'server', parents: ['network-zone', 'site'],
      message: 'server outside any network zone or site',
      help: 'move this `server` inside a `network-zone` or `site`' },
    { code: 'E0215', child: 'app-instance', parents: ['server', 'network-zone'],
      message: 'deployed application outside any server or zone',
      help: 'move this `app-instance` inside a `server` or `network-zone`' },
    { code: 'E0216', child: 'network-zone', parents: ['site', 'network-zone'],
      message: 'network zone outside any site',
      help: 'move this `network-zone` inside a `site` (or nest zones)' },
  ],
  minCounts: [],
  isolatedWarn: {
    code: 'W0510', kinds: ['app-instance'],
    message: 'isolated element: no incoming or outgoing flow',
  },
  defaults: {
    actor: {},
    site: { fill: '#f5f5f4', stroke: { color: '#8a8a85', style: 'solid', width: 1.4 } },
    'network-zone': { fill: '#ecf3ec', stroke: { color: '#6d9a6d', style: 'dashed', width: 1.2 } },
    server: { fill: '#ffffff', stroke: { color: '#55606b', style: 'solid', width: 1.5 } },
    'app-instance': { fill: '#fff7e6', stroke: { color: '#b08d2a', style: 'solid', width: 1.2 } },
    external: { fill: '#f0eef5', stroke: { color: '#9187b3', style: 'dashed', width: 1.2 } },
  },
  defaultsDark: {
    actor: {},
    site: { fill: '#26261f', stroke: { color: '#8a8a72', style: 'solid', width: 1.4 } },
    'network-zone': { fill: '#20291f', stroke: { color: '#5f8a5f', style: 'dashed', width: 1.2 } },
    server: { fill: '#252a31', stroke: { color: '#6b7885', style: 'solid', width: 1.5 } },
    'app-instance': { fill: '#2e2717', stroke: { color: '#b08d2a', style: 'solid', width: 1.2 } },
    external: { fill: '#2a2833', stroke: { color: '#7d72a0', style: 'dashed', width: 1.2 } },
  },
};

// Sensitivity levels, least → most trusted. Colored by exposure: public is the
// most exposed (warm), secret the most protected (cool/violet).
const SEC_LEVELS = ['public', 'internal', 'restricted', 'secret'];

export const securityView: View = {
  name: 'security',
  kinds: ['trust-zone', 'security-node', 'asset', 'actor-group', 'actor', 'external'],
  containerKinds: ['trust-zone', 'actor-group'],
  legendNames: {
    'trust-zone': 'Trust zone (sensitivity)', 'security-node': 'Filtering / security node',
    asset: 'Sensitive asset', 'actor-group': 'Actor group', actor: 'Actor', external: 'Untrusted external',
  },
  legendNamesFr: {
    'trust-zone': 'Zone de confiance (sensibilité)', 'security-node': 'Nœud de filtrage / sécurité',
    asset: 'Actif sensible', 'actor-group': "Groupe d'acteurs", actor: 'Acteur', external: 'Externe non maîtrisé',
  },
  bandTitles: { flows: 'FLOWS', objects: 'BUSINESS OBJECTS', legend: 'LEGEND' },
  legendFlowLabel: 'Security flow — cross-zone flows should be filtered and encrypted',
  legendFlowLabelFr: 'Flux de sécurité — les flux inter-zones doivent être filtrés et chiffrés',
  partitions: {},
  partitionByOrder: true, // zones band left→right in declaration order (exposed → protected)
  flowLabelRequired: {
    code: 'E0203',
    message: 'flow without a label',
    help: 'add a label describing the exchange: `A -> B : "…" (TLS1.3)`',
  },
  flowTechRequired: null,
  flowTechRecommended: null,
  attrSpec: {
    kind: 'trust-zone', values: SEC_LEVELS, code: 'E0250',
    message: 'trust zone without a valid sensitivity level',
    help: 'set a level in parentheses: `trust-zone DMZ "DMZ" (public)` — one of public, internal, restricted, secret',
  },
  trustOrder: { public: 0, internal: 1, restricted: 2, secret: 3 },
  boundaryLint: {
    code: 'W0560', nodeKind: 'security-node',
    message: 'unfiltered trust-boundary crossing',
    help: 'route this flow through a `security-node` (firewall/WAF/bastion), or confirm the direct path is intended',
  },
  crossZoneTechRecommended: {
    code: 'W0561',
    message: 'cross-zone flow without stated encryption/protocol',
    help: 'add the protocol/encryption on inter-zone flows: `A -> B : "…" (TLS1.3)`',
  },
  nesting: [
    { code: 'E0217', child: 'asset', parents: ['trust-zone'],
      message: 'sensitive asset outside any trust zone',
      help: 'move this `asset` inside a `trust-zone`' },
    { code: 'E0218', child: 'security-node', parents: ['trust-zone'],
      message: 'security node outside any trust zone',
      help: 'place this `security-node` inside a `trust-zone` (typically the exposed one it protects)' },
    { code: 'E0211', child: 'actor', parents: ['actor-group'],
      message: 'actor outside any group',
      help: 'move this `actor` inside an `actor-group`' },
  ],
  minCounts: [],
  isolatedWarn: {
    code: 'W0510', kinds: ['asset'],
    message: 'isolated element: no incoming or outgoing flow',
  },
  // trust-zone colors come from levelDefaults (by sensitivity); non-zone kinds use these.
  defaults: {
    'trust-zone': { fill: '#f5f5f4', stroke: { color: '#8a8a85', style: 'solid', width: 1.3 } },
    'security-node': { fill: '#fff7e6', stroke: { color: '#c46b2a', style: 'solid', width: 1.6 } },
    asset: { fill: '#ffffff', stroke: { color: '#55606b', style: 'solid', width: 1.3 } },
    'actor-group': { fill: '#eef4fb', stroke: { color: '#7a9cc4', style: 'dashed', width: 1.2 } },
    external: { fill: '#fdecea', stroke: { color: '#d9534f', style: 'dashed', width: 1.3 } },
    actor: {},
  },
  defaultsDark: {
    'trust-zone': { fill: '#26261f', stroke: { color: '#8a8a72', style: 'solid', width: 1.3 } },
    'security-node': { fill: '#2e2717', stroke: { color: '#c46b2a', style: 'solid', width: 1.6 } },
    asset: { fill: '#252a31', stroke: { color: '#6b7885', style: 'solid', width: 1.3 } },
    'actor-group': { fill: '#232a33', stroke: { color: '#5c7fa8', style: 'dashed', width: 1.2 } },
    external: { fill: '#3a2422', stroke: { color: '#c25a54', style: 'dashed', width: 1.3 } },
    actor: {},
  },
  levelDefaults: {
    public:     { fill: '#fdecea', stroke: { color: '#d9534f', style: 'solid', width: 1.4 } },
    internal:   { fill: '#fff4e5', stroke: { color: '#e0a458', style: 'solid', width: 1.4 } },
    restricted: { fill: '#e8f1f8', stroke: { color: '#5b8db8', style: 'solid', width: 1.4 } },
    secret:     { fill: '#ece8f5', stroke: { color: '#7a5fae', style: 'solid', width: 1.4 } },
  },
  levelDefaultsDark: {
    public:     { fill: '#3a2422', stroke: { color: '#c25a54', style: 'solid', width: 1.4 } },
    internal:   { fill: '#332a1c', stroke: { color: '#c08a44', style: 'solid', width: 1.4 } },
    restricted: { fill: '#1f2a33', stroke: { color: '#4a7ba6', style: 'solid', width: 1.4 } },
    secret:     { fill: '#2a2433', stroke: { color: '#7a5f9e', style: 'solid', width: 1.4 } },
  },
};

export const views: Record<string, View> = {
  logical: logicalView,
  application: applicationView,
  infrastructure: infrastructureView,
  security: securityView,
};

export const explanations: Record<string, string> = {
  E0101: 'Syntax error: the file does not follow the DSL grammar.',
  E0201: 'Unknown element kind for the active view. Each view defines its own kinds (e.g. logical: actor-group, actor, system, layer, block, external).',
  E0202: 'Duplicate identifier. IDs are flat and unique per file (decision D1): every element needs a distinct ID so flows can reference it unambiguously.',
  E0203: 'The logical view forbids unlabelled arrows: every flow must name the data, command or event it carries. A logical diagram tells what circulates, not just who talks to whom.',
  E0210: 'No functional block may sit "bare" at the diagram root: it always lives inside a layer, a system or an external system (principle: no floating blocks).',
  E0211: 'Actors are grouped by role inside actor-groups (reading convention: actor groups sit at the diagram edges).',
  E0212: 'A layer materializes an internal level of a system: it must be nested inside a system.',
  E0220: 'Unknown reference: the flow points to an ID that does not exist in this file.',
  W0502: 'Every element should carry a human-readable label — without one, its technical ID is displayed on the diagram. Write `actor ACT1 "Readable name"`.',
  W0501: 'Completeness check: a logical diagram without actors does not show who triggers or consumes the functions. Add the actors, or ignore this warning if the diagram is intentionally partial.',
  W0510: 'Completeness check: an element with no flow at all is either useless in this view, or waiting for its flows to be documented.',
  W0520: 'Slide/page capacity check: after scale-to-fit on the physical target (1280×720 slide or A4 page), label text would render below ~7px, which is unreadable when projected or printed. No layout can fix a diagram that carries more content than the medium can show — split the view into sub-diagrams (e.g. one per system), or use `wide`/`tall` for full-screen and print use.',
  E0213: 'Application modules always live inside an application container (application-view convention: applications decompose into modules).',
  E0214: 'Servers always live inside a network zone or a site — a machine without a network location cannot be secured or reached.',
  E0215: 'A deployed application (app-instance) must sit on a server or in a zone. It shows WHERE an application runs, without its internal detail (C4 deployment convention).',
  E0216: 'Network zones belong to a site (or nest inside a larger zone): DMZ and LAN only mean something relative to a perimeter.',
  W0540: 'C4 container-diagram practice: inter-process relationships should be labelled with their technology/protocol ("the how, not just the what"). Human/actor interactions are exempt. Add `(API_REST, JSON)` after the label, or ignore if the diagram is intentionally functional-only.',
  E0240: 'The infrastructure view requires every flow to carry its protocol (and port if relevant): the flow matrix is the primary output of this view. Add `(HTTPS/443)` after the label.',
  E0221: 'Unknown business-object reference: a flow carries `[AN_ID]` that no `business-object` declaration defines. Declare it once (`business-object ID "Name" "description"`) so the registry and the chips stay consistent.',
  W0530: 'Completeness check: a declared business object is never carried by any flow — either connect it to the flows that transport it, or remove it from this view.',
  E0217: 'A sensitive asset must sit inside a trust zone: its protection level is defined by the zone that contains it.',
  E0218: 'A security node (firewall, WAF, bastion, reverse proxy) lives inside a trust zone — typically the exposed zone whose traffic it filters.',
  E0250: 'The security view requires each trust zone to declare a sensitivity level in parentheses after the label: `trust-zone DMZ "DMZ" (public)`. Levels, least → most trusted: public, internal, restricted, secret. The level drives the zone color and the trust-boundary crossing checks.',
  W0560: 'Security check: this flow enters a more-trusted zone from a less-trusted one without passing through a security-node (firewall/WAF/bastion). Route it through a filtering point, or confirm the direct path is deliberate. This is the diagram equivalent of a missing firewall rule review.',
  W0561: 'Security check: an inter-zone flow does not state its encryption/protocol. Cross-zone traffic should declare how it is protected: add `(TLS1.3)` or the relevant protocol after the label.',
};
