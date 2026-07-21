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
  arrows: 'normal' | 'large';      // large: bigger arrowheads so endpoints stand out
  flowColor: 'none' | 'by-source'; // by-source: tint each flow + its arrowhead by its origin
  flowLabel: 'on-line' | 'above' | 'below';
  flowStroke: { color: string; style: 'solid' | 'dashed' | 'dotted'; width: number };
  flowStrokeColorSet: boolean;     // true once the author sets a flow-stroke color (else palette edge color)
  theme: string;                   // named theme (light, dark, slate, sand, contrast, nord, solarized, classic, classic-dark)
  accent?: string;                 // optional accent that retints flows on top of the theme
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
  arrows: 'normal',
  flowColor: 'none',
  flowLabel: 'on-line',
  flowStroke: { color: '#444444', style: 'solid', width: 1.3 },
  flowStrokeColorSet: false,
  theme: 'light',
  lang: 'en',
  kind: {},
  font: { family: 'Helvetica', size: 12.5 },  // base text size; edge = base-1, container = base+0.5
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

// Categorical hues for `flow-color: by-source` — each source gets one, cycling.
// Chosen to stay distinguishable against the light/dark canvases.
export const flowPalette: Record<'light' | 'dark', string[]> = {
  light: ['#1f77b4', '#d62728', '#2e8b57', '#9467bd', '#8c564b', '#c1288a', '#0e8ea6', '#9a9a1e', '#e07b00', '#5a5a5a'],
  dark:  ['#5fa8dc', '#f2695f', '#63c98a', '#b79ae0', '#c08a76', '#e878bd', '#4fc4d6', '#cfcf5a', '#f2a24e', '#a6a6a6'],
};

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
  businessObjects?: boolean;              // whether `business-object` / `[refs]` are part of this view (logical only)
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
  businessObjects: true, // business objects are a logical-view concept ("what data circulates")
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
  kinds: ['actor-group', 'actor', 'application', 'module', 'queue', 'datastore', 'external'],
  containerKinds: ['actor-group', 'application', 'external'],
  partitions: { 'actor-group': 0, application: 1, queue: 1, datastore: 1, external: 2 },
  legendNames: {
    'actor-group': 'Actor group', actor: 'Actor', application: 'Application',
    module: 'Application module', queue: 'Message queue / broker',
    datastore: 'Datastore / registry', external: 'External system',
  },
  legendNamesFr: {
    'actor-group': "Groupe d'acteurs", actor: 'Acteur', application: 'Application',
    module: 'Module applicatif', queue: 'File de messages / broker',
    datastore: 'Entrepôt / référentiel', external: 'Système externe',
  },
  bandTitles: { flows: 'FLOWS', objects: 'BUSINESS OBJECTS', legend: 'LEGEND' },
  legendFlowLabel: 'Application flow — (protocol, format) under the label',
  legendFlowLabelFr: 'Flux applicatif — (protocole, format) sous le libellé',
  flowLabelRequired: null, // labels are optional on the application view (issue #19)
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
    code: 'W0510', kinds: ['module', 'queue', 'datastore'],
    message: 'isolated element: no incoming or outgoing flow',
  },
  defaults: {
    'actor-group': { fill: '#eef4fb', stroke: { color: '#7a9cc4', style: 'dashed', width: 1.2 } },
    application: { fill: '#e8f1f8', stroke: { color: '#5b8db8', style: 'solid', width: 1.2 } },
    module: { fill: '#ffffff', stroke: { color: '#5b7a99', style: 'solid', width: 1.3 } },
    queue: { fill: '#f3eef8', stroke: { color: '#8a6fae', style: 'solid', width: 1.3 } },
    datastore: { fill: '#f3eef8', stroke: { color: '#8a6fae', style: 'solid', width: 1.3 } },
    external: { fill: '#f0eef5', stroke: { color: '#9187b3', style: 'dashed', width: 1.2 } },
    actor: {},
  },
  defaultsDark: {
    'actor-group': { fill: '#232a33', stroke: { color: '#5c7fa8', style: 'dashed', width: 1.2 } },
    application: { fill: '#1f2a33', stroke: { color: '#4a7ba6', style: 'solid', width: 1.2 } },
    module: { fill: '#252a31', stroke: { color: '#5f7f9e', style: 'solid', width: 1.3 } },
    queue: { fill: '#2a2433', stroke: { color: '#7a5f9e', style: 'solid', width: 1.3 } },
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
  kinds: ['actor', 'site', 'network-zone', 'server', 'app-instance', 'queue', 'gateway', 'auth', 'idp', 'external'],
  containerKinds: ['site', 'network-zone', 'server'],
  partitions: { external: 2 },
  partitionByOrder: true, // zones/sites band left->right in declaration order
  actorLegend: true,      // users are standalone actors here — key them in the legend
  legendNames: {
    actor: 'User / consumer',
    site: 'Site / data center', 'network-zone': 'Network zone', server: 'Server / VM',
    'app-instance': 'Deployed application', queue: 'Message queue / broker',
    gateway: 'Gateway / reverse proxy', auth: 'Auth middleware', idp: 'Identity provider (IdP)',
    external: 'External system',
  },
  legendNamesFr: {
    actor: 'Utilisateur / consommateur',
    site: 'Site / centre de données', 'network-zone': 'Zone réseau', server: 'Serveur / VM',
    'app-instance': 'Application déployée', queue: 'File de messages / broker',
    gateway: 'Passerelle / proxy', auth: 'Middleware d\'authentification', idp: 'Fournisseur d\'identité (IdP)',
    external: 'Système externe',
  },
  bandTitles: { flows: 'FLOWS', objects: 'BUSINESS OBJECTS', legend: 'LEGEND' },
  legendFlowLabel: 'Technical flow (protocol, port)',
  legendFlowLabelFr: 'Flux technique (protocole, port)',
  flowLabelRequired: null, // labels are optional on the infrastructure view (issue #19); protocol stays required (E0240)
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
    code: 'W0510', kinds: ['app-instance', 'queue', 'gateway', 'auth', 'idp'],
    message: 'isolated element: no incoming or outgoing flow',
  },
  defaults: {
    actor: {},
    site: { fill: '#f5f5f4', stroke: { color: '#8a8a85', style: 'solid', width: 1.4 } },
    'network-zone': { fill: '#ecf3ec', stroke: { color: '#6d9a6d', style: 'dashed', width: 1.2 } },
    server: { fill: '#ffffff', stroke: { color: '#55606b', style: 'solid', width: 1.5 } },
    'app-instance': { fill: '#fff7e6', stroke: { color: '#b08d2a', style: 'solid', width: 1.2 } },
    queue: { fill: '#f3eef8', stroke: { color: '#8a6fae', style: 'solid', width: 1.3 } },
    gateway: { fill: '#f5e6dd', stroke: { color: '#bf5530', style: 'solid', width: 1.6 } },
    auth: { fill: '#fef3e2', stroke: { color: '#d68a2a', style: 'solid', width: 1.5 } },
    idp: { fill: '#e0f0f0', stroke: { color: '#3a8f8f', style: 'solid', width: 1.3 } },
    external: { fill: '#f0eef5', stroke: { color: '#9187b3', style: 'dashed', width: 1.2 } },
  },
  defaultsDark: {
    actor: {},
    site: { fill: '#26261f', stroke: { color: '#8a8a72', style: 'solid', width: 1.4 } },
    'network-zone': { fill: '#20291f', stroke: { color: '#5f8a5f', style: 'dashed', width: 1.2 } },
    server: { fill: '#252a31', stroke: { color: '#6b7885', style: 'solid', width: 1.5 } },
    'app-instance': { fill: '#2e2717', stroke: { color: '#b08d2a', style: 'solid', width: 1.2 } },
    queue: { fill: '#2a2433', stroke: { color: '#7a5f9e', style: 'solid', width: 1.3 } },
    gateway: { fill: '#332218', stroke: { color: '#c96a4a', style: 'solid', width: 1.6 } },
    auth: { fill: '#332614', stroke: { color: '#b88a30', style: 'solid', width: 1.5 } },
    idp: { fill: '#1a2e2e', stroke: { color: '#4fafaf', style: 'solid', width: 1.3 } },
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

// ---------------- Themes ----------------
// A theme = a chrome Palette + a set of ROLE colours. Views map their kinds to
// roles (KIND_ROLE), so each theme is defined once and stays consistent across
// all four views. `classic` / `classic-dark` reuse the original per-view
// defaults, so the pre-theme look is reproduced exactly.
export interface Theme { palette: Palette; roles: Record<string, StyleProps>; levels: Record<string, StyleProps>; }

const cont = (fill: string, stroke: string, dashed = false, width = 1.2): StyleProps =>
  ({ fill, stroke: { color: stroke, style: dashed ? 'dashed' : 'solid', width } });
const leaf = (fill: string, stroke: string, width = 1.3): StyleProps =>
  ({ fill, stroke: { color: stroke, style: 'solid', width } });

const KIND_ROLE: Record<string, string> = {
  'actor-group': 'actorGroup', actor: 'actor', system: 'system', application: 'application',
  module: 'leaf', layer: 'layer', block: 'leaf', external: 'external', datastore: 'datastore',
  queue: 'datastore', // a message queue is a data conduit — shares the datastore palette, distinguished by its horizontal-cylinder shape
  gateway: 'authGateway', auth: 'auth', idp: 'identityProvider',
  site: 'site', 'network-zone': 'networkZone', server: 'server', 'app-instance': 'appInstance',
  'security-node': 'securityNode', asset: 'leaf',
};
const roleFor = (kind: string, viewName: string): string =>
  viewName === 'security' && kind === 'external' ? 'untrusted' : (KIND_ROLE[kind] ?? 'leaf');

interface ThemeSpec {
  pal: { bg: string; text: string; sub: string; muted: string; cFill: string; cStroke: string; nFill: string; nStroke: string; edge: string; div: string; halo: string; aStroke: string; aText: string; chip: [string, string, string]; badge: [string, string] };
  h: Record<string, string>;                 // hue set
  lv: Record<string, [string, string]>;      // security levels -> [fill, stroke]
}
const mkTheme = (s: ThemeSpec): Theme => {
  const p = s.pal, h = s.h;
  const palette: Palette = {
    background: p.bg, containerLabel: p.text, containerFill: p.cFill, containerStroke: p.cStroke,
    nodeText: p.text, nodeFill: p.nFill, nodeStroke: p.nStroke,
    actorStroke: p.aStroke, actorText: p.aText, edge: p.edge, edgeLabel: p.sub, techText: p.muted, halo: p.halo,
    bandTitle: p.sub, bandText: p.text, bandMuted: p.muted, divider: p.div,
    badgeFill: p.badge[0], badgeStroke: p.badge[1], chipFill: p.chip[0], chipStroke: p.chip[1], chipText: p.chip[2],
  };
  return {
    palette,
    roles: {
      actor: {},
      actorGroup: cont(h.blueF, h.blue, true),
      system: cont(h.amberF, h.amber),
      application: cont(h.appF, h.app),
      layer: cont(h.goldF, h.gold, false, 1),
      external: cont(h.violetF, h.violet, true),
      untrusted: cont(h.redF, h.red, true, 1.3),
      leaf: leaf(h.leafF, h.leafS),
      datastore: leaf(h.purpleF, h.purple),
      site: cont(h.siteF, h.siteS, false, 1.4),
      networkZone: cont(h.greenF, h.green, true),
      server: cont(h.serverF, h.serverS, false, 1.5),
      appInstance: leaf(h.aiF, h.aiS, 1.2),
      securityNode: leaf(h.nodeF, h.node, 1.6),
      authGateway: leaf(h.authF, h.auth, 1.4),
      auth: leaf(h.nodeF, h.node, 1.5),
      identityProvider: leaf(h.idpF, h.idp),
    },
    levels: {
      public: cont(s.lv.public[0], s.lv.public[1], false, 1.4),
      internal: cont(s.lv.internal[0], s.lv.internal[1], false, 1.4),
      restricted: cont(s.lv.restricted[0], s.lv.restricted[1], false, 1.4),
      secret: cont(s.lv.secret[0], s.lv.secret[1], false, 1.4),
    },
  };
};

export const themes: Record<string, Theme> = {
  // modern professional — the new default
  light: mkTheme({
    pal: { bg: '#ffffff', text: '#17202c', sub: '#3a4553', muted: '#79828f', cFill: '#f5f6f8', cStroke: '#c7ccd3', nFill: '#ffffff', nStroke: '#48546a', edge: '#5a6675', div: '#e6e9ee', halo: '#ffffff', aStroke: '#1f5e91', aText: '#20364c', chip: ['#fff2d4', '#d3a01f', '#6a5111'], badge: ['#ffffff', '#8a94a2'] },
    h: { blue: '#1f77b4', blueF: '#e9f2fb', amber: '#c17d1c', amberF: '#fbf4e9', app: '#2f83b6', appF: '#e9f3fa', gold: '#cf9f2f', goldF: '#fdfaf0', violet: '#8659a6', violetF: '#f4eff8', red: '#cf4b3f', redF: '#fdecea', purple: '#8a53a8', purpleF: '#f4edf8', green: '#1a8f66', greenF: '#eaf5ef', siteS: '#7c8794', siteF: '#f3f5f6', leafF: '#ffffff', leafS: '#48546a', aiS: '#c88a2e', aiF: '#fdf4e3', node: '#d1600f', nodeF: '#fdefe3', serverS: '#48546a', serverF: '#ffffff', auth: '#b85a30', authF: '#f5e6dd', idp: '#3a8f8f', idpF: '#e0f0f0' },
    lv: { public: ['#fdeceb', '#d0463f'], internal: ['#fef2e2', '#cf9436'], restricted: ['#e9f2fb', '#2f7cc4'], secret: ['#efe9f7', '#7a55a8'] },
  }),
  dark: mkTheme({
    pal: { bg: '#1e2530', text: '#e6edf3', sub: '#c2ccd6', muted: '#93a0ab', cFill: '#2a313c', cStroke: '#4a5560', nFill: '#252c37', nStroke: '#5a6673', edge: '#9aa7b4', div: '#3a4149', halo: '#1e2530', aStroke: '#8aa0b8', aText: '#c9d5e1', chip: ['#3a3320', '#b08d2a', '#e0c068'], badge: ['#252c37', '#5a6673'] },
    h: { blue: '#5aa9e6', blueF: '#233242', amber: '#e0a955', amberF: '#332a1b', app: '#5aa9e6', appF: '#1f2a37', gold: '#d8c15f', goldF: '#2e2a1a', violet: '#b48ad6', violetF: '#2a2436', red: '#e0736a', redF: '#3a2422', purple: '#c085d8', purpleF: '#291f33', green: '#4fc08a', greenF: '#1c2b23', siteS: '#8a95a2', siteF: '#282d34', leafF: '#252c37', leafS: '#6b7885', aiS: '#e0a955', aiF: '#2e2717', node: '#f0894e', nodeF: '#33261c', serverS: '#6b7885', serverF: '#252c37', auth: '#c96a4a', authF: '#332218', idp: '#4fafaf', idpF: '#1a2e2e' },
    lv: { public: ['#3a2422', '#c25a54'], internal: ['#332a1c', '#c08a44'], restricted: ['#1f2a37', '#4a86b8'], secret: ['#291f33', '#8a6cb0'] },
  }),
  slate: mkTheme({
    pal: { bg: '#f7f9fb', text: '#26303c', sub: '#465264', muted: '#8792a0', cFill: '#eef2f6', cStroke: '#c2ccd6', nFill: '#ffffff', nStroke: '#516070', edge: '#5b6673', div: '#e0e6ec', halo: '#f7f9fb', aStroke: '#3b6ea5', aText: '#2b4560', chip: ['#eaeef3', '#8595a8', '#48566a'], badge: ['#ffffff', '#93a0b0'] },
    h: { blue: '#3b6ea5', blueF: '#e8eff6', amber: '#5b7a99', amberF: '#eef2f6', app: '#3b6ea5', appF: '#e8eff6', gold: '#7a94ad', goldF: '#f0f3f6', violet: '#7d6ba8', violetF: '#efecf5', red: '#b5544a', redF: '#f7ebe9', purple: '#8a6fae', purpleF: '#efecf6', green: '#4a8f8a', greenF: '#e9f2f1', siteS: '#8792a0', siteF: '#eef1f4', leafF: '#ffffff', leafS: '#516070', aiS: '#6f86a0', aiF: '#eef2f6', node: '#c0603a', nodeF: '#f8ece7', serverS: '#516070', serverF: '#ffffff', auth: '#a85a30', authF: '#f0e4dd', idp: '#3a8f8f', idpF: '#e4f0f0' },
    lv: { public: ['#f7ece9', '#c05a4a'], internal: ['#f3efe6', '#a8823f'], restricted: ['#e8eff6', '#3b6ea5'], secret: ['#efecf5', '#7d6ba8'] },
  }),
  sand: mkTheme({
    pal: { bg: '#faf6ee', text: '#3a2f22', sub: '#5c4c38', muted: '#8a795f', cFill: '#f2ebdd', cStroke: '#cdbfa3', nFill: '#fffdf8', nStroke: '#6b5d48', edge: '#6b5d48', div: '#e6dcc9', halo: '#faf6ee', aStroke: '#3f7a8c', aText: '#274852', chip: ['#f4e6c8', '#c19a3f', '#6b5417'], badge: ['#fffdf8', '#b3a488'] },
    h: { blue: '#3f7a8c', blueF: '#e6f0f1', amber: '#b07d2a', amberF: '#f6ecd8', app: '#3f7a8c', appF: '#e6f0f1', gold: '#c99f45', goldF: '#f8f0dd', violet: '#9c6f4a', violetF: '#f1e9df', red: '#c0562a', redF: '#f7e6da', purple: '#8a5f7a', purpleF: '#f2e8ee', green: '#6f8f4a', greenF: '#eef2e2', siteS: '#8a795f', siteF: '#f2ecdf', leafF: '#fffdf8', leafS: '#6b5d48', aiS: '#b07d2a', aiF: '#f7efe0', node: '#c0562a', nodeF: '#f7e6da', serverS: '#6b5d48', serverF: '#fffdf8', auth: '#a85a30', authF: '#f0e5dd', idp: '#3a7a6f', idpF: '#e5f0ed' },
    lv: { public: ['#f7e2da', '#c0562a'], internal: ['#f6ecd2', '#b0842e'], restricted: ['#e6f0f1', '#3f7a8c'], secret: ['#f0e8ef', '#8a5f7a'] },
  }),
  contrast: mkTheme({
    pal: { bg: '#ffffff', text: '#000000', sub: '#1a1a1a', muted: '#3a3a3a', cFill: '#f2f2f2', cStroke: '#333333', nFill: '#ffffff', nStroke: '#111111', edge: '#1a1a1a', div: '#cccccc', halo: '#ffffff', aStroke: '#003a66', aText: '#000000', chip: ['#ffe9b0', '#8a6d00', '#3a2e00'], badge: ['#ffffff', '#333333'] },
    h: { blue: '#005a9c', blueF: '#e0edf7', amber: '#9a4a00', amberF: '#f6e9dd', app: '#005a9c', appF: '#e0edf7', gold: '#8a6d00', goldF: '#f6f0da', violet: '#6a2fa0', violetF: '#eee4f7', red: '#c0341a', redF: '#f9e2dd', purple: '#8a1a6a', purpleF: '#f7e0ef', green: '#00695c', greenF: '#daf0ec', siteS: '#333333', siteF: '#eeeeee', leafF: '#ffffff', leafS: '#111111', aiS: '#9a4a00', aiF: '#f6e9dd', node: '#c0341a', nodeF: '#f9e2dd', serverS: '#111111', serverF: '#ffffff', auth: '#993a1a', authF: '#f6e3dd', idp: '#005a5a', idpF: '#daf0f0' },
    lv: { public: ['#f9dcd6', '#c0341a'], internal: ['#f6e6c8', '#9a6a00'], restricted: ['#e0edf7', '#005a9c'], secret: ['#eee0f7', '#6a2fa0'] },
  }),
  nord: mkTheme({
    pal: { bg: '#2e3440', text: '#eceff4', sub: '#d8dee9', muted: '#9aa3b2', cFill: '#3b4252', cStroke: '#4c566a', nFill: '#3b4252', nStroke: '#4c566a', edge: '#abb2bf', div: '#434c5e', halo: '#2e3440', aStroke: '#88c0d0', aText: '#e5e9f0', chip: ['#3b3a2a', '#ebcb8b', '#ebcb8b'], badge: ['#3b4252', '#4c566a'] },
    h: { blue: '#81a1c1', blueF: '#333b4a', amber: '#ebcb8b', amberF: '#3a3524', app: '#81a1c1', appF: '#2f3a44', gold: '#d0b47a', goldF: '#37331f', violet: '#b48ead', violetF: '#352d38', red: '#bf616a', redF: '#3a2a2d', purple: '#a38bbd', purpleF: '#312a3a', green: '#8fbcbb', greenF: '#26332f', siteS: '#9aa3b2', siteF: '#353c49', leafF: '#3b4252', leafS: '#5a6377', aiS: '#ebcb8b', aiF: '#3a3524', node: '#d08770', nodeF: '#372a24', serverS: '#5a6377', serverF: '#3b4252', auth: '#c96a4a', authF: '#332218', idp: '#6fafaf', idpF: '#203432' },
    lv: { public: ['#3a2a2d', '#bf616a'], internal: ['#3a3524', '#d0a85f'], restricted: ['#2f3a44', '#81a1c1'], secret: ['#312a3a', '#a38bbd'] },
  }),
  solarized: mkTheme({
    pal: { bg: '#fdf6e3', text: '#586e75', sub: '#657b83', muted: '#93a1a1', cFill: '#eee8d5', cStroke: '#c9c1a8', nFill: '#fdf6e3', nStroke: '#93a1a1', edge: '#657b83', div: '#ded8c3', halo: '#fdf6e3', aStroke: '#268bd2', aText: '#073642', chip: ['#f2e9c8', '#b58900', '#5c4a00'], badge: ['#fdf6e3', '#b3aa90'] },
    h: { blue: '#268bd2', blueF: '#e3edf3', amber: '#b58900', amberF: '#f2ecd6', app: '#268bd2', appF: '#e3edf3', gold: '#cb9b2e', goldF: '#f4eed6', violet: '#6c71c4', violetF: '#e8e6f2', red: '#dc322f', redF: '#f7e2d9', purple: '#d33682', purpleF: '#f6e0ea', green: '#2aa198', greenF: '#dff0ec', siteS: '#93a1a1', siteF: '#eee8d5', leafF: '#fdf6e3', leafS: '#657b83', aiS: '#b58900', aiF: '#f2ecd6', node: '#cb4b16', nodeF: '#f7e4d6', serverS: '#657b83', serverF: '#fdf6e3', auth: '#b85a30', authF: '#f5e6dd', idp: '#2aa198', idpF: '#dff0ec' },
    lv: { public: ['#f7ddd6', '#dc322f'], internal: ['#f2e6c8', '#b58900'], restricted: ['#e3edf3', '#268bd2'], secret: ['#e8e6f2', '#6c71c4'] },
  }),
};

export const themeNames: string[] = [...Object.keys(themes), 'classic', 'classic-dark'];

// Resolve the active theme for a view: chrome palette + a kind->style map (built
// from roles) + security levels. `classic` reuses the original view defaults.
export function themeFor(name: string, view: View): { palette: Palette; kinds: Record<string, StyleProps>; levels: Record<string, StyleProps> } {
  if (name === 'classic') return { palette: lightPalette, kinds: view.defaults, levels: view.levelDefaults ?? {} };
  if (name === 'classic-dark') return { palette: darkPalette, kinds: view.defaultsDark, levels: view.levelDefaultsDark ?? {} };
  const t = themes[name] ?? themes.light;
  const kinds: Record<string, StyleProps> = {};
  for (const k of view.kinds) kinds[k] = t.roles[roleFor(k, view.name)] ?? {};
  return { palette: t.palette, kinds, levels: t.levels };
}

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
  E0222: 'Business objects are a logical-view concept (what data circulates between functional blocks). They are not part of the application, infrastructure, or security views — model the exchange with the flow label and technical tail instead. Remove the `business-object` declaration and its `[refs]`, or switch the diagram to `logical`.',
  W0530: 'Completeness check: a declared business object is never carried by any flow — either connect it to the flows that transport it, or remove it from this view.',
  E0217: 'A sensitive asset must sit inside a trust zone: its protection level is defined by the zone that contains it.',
  E0218: 'A security node (firewall, WAF, bastion, reverse proxy) lives inside a trust zone — typically the exposed zone whose traffic it filters.',
  E0250: 'The security view requires each trust zone to declare a sensitivity level in parentheses after the label: `trust-zone DMZ "DMZ" (public)`. Levels, least → most trusted: public, internal, restricted, secret. The level drives the zone color and the trust-boundary crossing checks.',
  W0560: 'Security check: this flow enters a more-trusted zone from a less-trusted one without passing through a security-node (firewall/WAF/bastion). Route it through a filtering point, or confirm the direct path is deliberate. This is the diagram equivalent of a missing firewall rule review.',
  W0561: 'Security check: an inter-zone flow does not state its encryption/protocol. Cross-zone traffic should declare how it is protected: add `(TLS1.3)` or the relevant protocol after the label.',
};
