/**
 * The `views` registry: one `View` per diagram type (logical, application,
 * infrastructure, security) defining its allowed element kinds, nesting rules,
 * flow requirements, trust-boundary/attribute specs, legend labels (en/fr) and
 * layout partitions. This is the data that makes each view "typed" — the
 * validator and layout read from it, so adding a view starts here.
 */

import type { StyleProps } from "./models/ast.ts";

export interface NestingRule {
  code: string;
  child: string;
  parents: string[];
  message: string;
  help: string;
}

export interface View {
  name: string;
  kinds: string[];
  containerKinds: string[];
  legendNames: Record<string, string>;
  legendNamesFr: Record<string, string>;
  bandTitles: { flows: string; objects: string; legend: string };
  partitions: Record<string, number>;
  partitionByOrder?: boolean;
  actorLegend?: boolean;
  legendFlowLabel: string;
  legendFlowLabelFr: string;
  flowLabelRequired: {
    code: string;
    message: string;
    help: string;
  } | null;
  businessObjects?: boolean;
  flowTechRequired: {
    code: string;
    message: string;
    help: string;
  } | null;
  flowTechRecommended: {
    code: string;
    message: string;
    help: string;
  } | null;
  nesting: NestingRule[];
  minCounts: {
    code: string;
    kind: string;
    min: number;
    message: string;
  }[];
  isolatedWarn: {
    code: string;
    kinds: string[];
    message: string;
  } | null;
  defaults: Record<string, StyleProps>;
  defaultsDark: Record<string, StyleProps>;
  attrSpec?: {
    kind: string;
    values: string[];
    code: string;
    message: string;
    help: string;
  };
  trustOrder?: Record<string, number>;
  boundaryLint?: {
    code: string;
    nodeKind: string;
    message: string;
    help: string;
  };
  crossZoneTechRecommended?: {
    code: string;
    message: string;
    help: string;
  };
  levelDefaults?: Record<string, StyleProps>;
  levelDefaultsDark?: Record<string, StyleProps>;
}

export const logicalView: View = {
  name: "logical",
  kinds: ["actor-group", "actor", "system", "layer", "block", "external"],
  containerKinds: ["actor-group", "system", "layer", "external"],
  legendNames: {
    "actor-group": "Actor group",
    actor: "Actor",
    system: "System",
    layer: "Layer",
    block: "Functional block",
    external: "External system",
  },
  legendNamesFr: {
    "actor-group": "Groupe d'acteurs",
    actor: "Acteur",
    system: "Syst\u00e8me",
    layer: "Couche",
    block: "Bloc fonctionnel",
    external: "Syst\u00e8me externe",
  },
  bandTitles: {
    flows: "FLOWS",
    objects: "BUSINESS OBJECTS",
    legend: "LEGEND",
  },
  legendFlowLabel: "Functional flow (label = exchanged data)",
  legendFlowLabelFr: "Flux fonctionnel (libell\u00e9 = donn\u00e9es \u00e9chang\u00e9es)",
  flowTechRequired: null,
  flowTechRecommended: null,
  businessObjects: true,
  partitions: { "actor-group": 0, system: 1, external: 2 },
  flowLabelRequired: {
    code: "E0203",
    message: "flow without a label",
    help: 'add a label describing the exchanged data: `A -> B : "\u2026"`',
  },
  nesting: [
    {
      code: "E0210",
      child: "block",
      parents: ["layer", "system", "external"],
      message: "functional block outside any system",
      help: "move this `block` inside a `layer`, `system` or `external`",
    },
    {
      code: "E0211",
      child: "actor",
      parents: ["actor-group"],
      message: "actor outside any group",
      help: "move this `actor` inside an `actor-group`",
    },
    {
      code: "E0212",
      child: "layer",
      parents: ["system"],
      message: "layer outside any system",
      help: "move this `layer` inside a `system`",
    },
  ],
  minCounts: [
    {
      code: "W0501",
      kind: "actor",
      min: 1,
      message: "no actor declared",
    },
  ],
  isolatedWarn: {
    code: "W0510",
    kinds: ["block"],
    message: "isolated element: no incoming or outgoing flow",
  },
  defaults: {
    "actor-group": {
      fill: "#eef4fb",
      stroke: { color: "#7a9cc4", style: "dashed", width: 1.2 },
    },
    system: {
      fill: "#f6f2ea",
      stroke: { color: "#b09a6d", style: "solid", width: 1.2 },
    },
    layer: {
      fill: "#fdfbf6",
      stroke: { color: "#c4b258", style: "solid", width: 1 },
    },
    external: {
      fill: "#f0eef5",
      stroke: { color: "#9187b3", style: "dashed", width: 1.2 },
    },
    block: {
      fill: "#ffffff",
      stroke: { color: "#666677", style: "solid", width: 1.3 },
    },
    actor: {},
  },
  defaultsDark: {
    "actor-group": {
      fill: "#232a33",
      stroke: { color: "#5c7fa8", style: "dashed", width: 1.2 },
    },
    system: {
      fill: "#2b2822",
      stroke: { color: "#9c8558", style: "solid", width: 1.2 },
    },
    layer: {
      fill: "#26241d",
      stroke: { color: "#a89446", style: "solid", width: 1 },
    },
    external: {
      fill: "#2a2833",
      stroke: { color: "#7d72a0", style: "dashed", width: 1.2 },
    },
    block: {
      fill: "#252a31",
      stroke: { color: "#7c8894", style: "solid", width: 1.3 },
    },
    actor: {},
  },
};

export const applicationView: View = {
  name: "application",
  kinds: ["actor-group", "actor", "application", "module", "queue", "datastore", "external"],
  containerKinds: ["actor-group", "application", "external"],
  partitions: {
    "actor-group": 0,
    application: 1,
    queue: 1,
    datastore: 1,
    external: 2,
  },
  legendNames: {
    "actor-group": "Actor group",
    actor: "Actor",
    application: "Application",
    module: "Application module",
    queue: "Message queue / broker",
    datastore: "Datastore / registry",
    external: "External system",
  },
  legendNamesFr: {
    "actor-group": "Groupe d'acteurs",
    actor: "Acteur",
    application: "Application",
    module: "Module applicatif",
    queue: "File de messages / broker",
    datastore: "Entrep\u00f4t / r\u00e9f\u00e9rentiel",
    external: "Syst\u00e8me externe",
  },
  bandTitles: {
    flows: "FLOWS",
    objects: "BUSINESS OBJECTS",
    legend: "LEGEND",
  },
  legendFlowLabel: "Application flow — (protocol, format) under the label",
  legendFlowLabelFr: "Flux applicatif — (protocole, format) sous le libell\u00e9",
  flowLabelRequired: null,
  flowTechRequired: null,
  flowTechRecommended: {
    code: "W0540",
    message: "system-to-system flow without protocol",
    help: 'add the technology: `A -> B : "\u2026" (API_REST, JSON)` (C4 practice: label the how, not just the what)',
  },
  nesting: [
    {
      code: "E0213",
      child: "module",
      parents: ["application"],
      message: "module outside any application",
      help: "move this `module` inside an `application`",
    },
    {
      code: "E0211",
      child: "actor",
      parents: ["actor-group"],
      message: "actor outside any group",
      help: "move this `actor` inside an `actor-group`",
    },
  ],
  minCounts: [],
  isolatedWarn: {
    code: "W0510",
    kinds: ["module", "queue", "datastore"],
    message: "isolated element: no incoming or outgoing flow",
  },
  defaults: {
    "actor-group": {
      fill: "#eef4fb",
      stroke: { color: "#7a9cc4", style: "dashed", width: 1.2 },
    },
    application: {
      fill: "#e8f1f8",
      stroke: { color: "#5b8db8", style: "solid", width: 1.2 },
    },
    module: {
      fill: "#ffffff",
      stroke: { color: "#5b7a99", style: "solid", width: 1.3 },
    },
    queue: {
      fill: "#f3eef8",
      stroke: { color: "#8a6fae", style: "solid", width: 1.3 },
    },
    datastore: {
      fill: "#f3eef8",
      stroke: { color: "#8a6fae", style: "solid", width: 1.3 },
    },
    external: {
      fill: "#f0eef5",
      stroke: { color: "#9187b3", style: "dashed", width: 1.2 },
    },
    actor: {},
  },
  defaultsDark: {
    "actor-group": {
      fill: "#232a33",
      stroke: { color: "#5c7fa8", style: "dashed", width: 1.2 },
    },
    application: {
      fill: "#1f2a33",
      stroke: { color: "#4a7ba6", style: "solid", width: 1.2 },
    },
    module: {
      fill: "#252a31",
      stroke: { color: "#5f7f9e", style: "solid", width: 1.3 },
    },
    queue: {
      fill: "#2a2433",
      stroke: { color: "#7a5f9e", style: "solid", width: 1.3 },
    },
    datastore: {
      fill: "#2a2433",
      stroke: { color: "#7a5f9e", style: "solid", width: 1.3 },
    },
    external: {
      fill: "#2a2833",
      stroke: { color: "#7d72a0", style: "dashed", width: 1.2 },
    },
    actor: {},
  },
};

export const infrastructureView: View = {
  name: "infrastructure",
  kinds: [
    "actor",
    "site",
    "network-zone",
    "server",
    "app-instance",
    "queue",
    "gateway",
    "auth",
    "idp",
    "external",
  ],
  containerKinds: ["site", "network-zone", "server"],
  partitions: { external: 2 },
  partitionByOrder: true,
  actorLegend: true,
  legendNames: {
    actor: "User / consumer",
    site: "Site / data center",
    "network-zone": "Network zone",
    server: "Server / VM",
    "app-instance": "Deployed application",
    queue: "Message queue / broker",
    gateway: "Gateway / reverse proxy",
    auth: "Auth middleware",
    idp: "Identity provider (IdP)",
    external: "External system",
  },
  legendNamesFr: {
    actor: "Utilisateur / consommateur",
    site: "Site / centre de donn\u00e9es",
    "network-zone": "Zone r\u00e9seau",
    server: "Serveur / VM",
    "app-instance": "Application d\u00e9ploy\u00e9e",
    queue: "File de messages / broker",
    gateway: "Passerelle / proxy",
    auth: "Middleware d'authentification",
    idp: "Fournisseur d'identit\u00e9 (IdP)",
    external: "Syst\u00e8me externe",
  },
  bandTitles: {
    flows: "FLOWS",
    objects: "BUSINESS OBJECTS",
    legend: "LEGEND",
  },
  legendFlowLabel: "Technical flow (protocol, port)",
  legendFlowLabelFr: "Flux technique (protocole, port)",
  flowLabelRequired: null,
  flowTechRecommended: null,
  flowTechRequired: {
    code: "E0240",
    message: "technical flow without protocol",
    help: 'the infrastructure view requires a protocol: `A -> B : "\u2026" (HTTPS/443)`',
  },
  nesting: [
    {
      code: "E0214",
      child: "server",
      parents: ["network-zone", "site"],
      message: "server outside any network zone or site",
      help: "move this `server` inside a `network-zone` or `site`",
    },
    {
      code: "E0215",
      child: "app-instance",
      parents: ["server", "network-zone"],
      message: "deployed application outside any server or zone",
      help: "move this `app-instance` inside a `server` or `network-zone`",
    },
    {
      code: "E0216",
      child: "network-zone",
      parents: ["site", "network-zone"],
      message: "network zone outside any site",
      help: "move this `network-zone` inside a `site` (or nest zones)",
    },
  ],
  minCounts: [],
  isolatedWarn: {
    code: "W0510",
    kinds: ["app-instance", "queue", "gateway", "auth", "idp"],
    message: "isolated element: no incoming or outgoing flow",
  },
  defaults: {
    actor: {},
    site: {
      fill: "#f5f5f4",
      stroke: { color: "#8a8a85", style: "solid", width: 1.4 },
    },
    "network-zone": {
      fill: "#ecf3ec",
      stroke: { color: "#6d9a6d", style: "dashed", width: 1.2 },
    },
    server: {
      fill: "#ffffff",
      stroke: { color: "#55606b", style: "solid", width: 1.5 },
    },
    "app-instance": {
      fill: "#fff7e6",
      stroke: { color: "#b08d2a", style: "solid", width: 1.2 },
    },
    queue: {
      fill: "#f3eef8",
      stroke: { color: "#8a6fae", style: "solid", width: 1.3 },
    },
    gateway: {
      fill: "#f5e6dd",
      stroke: { color: "#bf5530", style: "solid", width: 1.6 },
    },
    auth: {
      fill: "#fef3e2",
      stroke: { color: "#d68a2a", style: "solid", width: 1.5 },
    },
    idp: {
      fill: "#e0f0f0",
      stroke: { color: "#3a8f8f", style: "solid", width: 1.3 },
    },
    external: {
      fill: "#f0eef5",
      stroke: { color: "#9187b3", style: "dashed", width: 1.2 },
    },
  },
  defaultsDark: {
    actor: {},
    site: {
      fill: "#26261f",
      stroke: { color: "#8a8a72", style: "solid", width: 1.4 },
    },
    "network-zone": {
      fill: "#20291f",
      stroke: { color: "#5f8a5f", style: "dashed", width: 1.2 },
    },
    server: {
      fill: "#252a31",
      stroke: { color: "#6b7885", style: "solid", width: 1.5 },
    },
    "app-instance": {
      fill: "#2e2717",
      stroke: { color: "#b08d2a", style: "solid", width: 1.2 },
    },
    queue: {
      fill: "#2a2433",
      stroke: { color: "#7a5f9e", style: "solid", width: 1.3 },
    },
    gateway: {
      fill: "#332218",
      stroke: { color: "#c96a4a", style: "solid", width: 1.6 },
    },
    auth: {
      fill: "#332614",
      stroke: { color: "#b88a30", style: "solid", width: 1.5 },
    },
    idp: {
      fill: "#1a2e2e",
      stroke: { color: "#4fafaf", style: "solid", width: 1.3 },
    },
    external: {
      fill: "#2a2833",
      stroke: { color: "#7d72a0", style: "dashed", width: 1.2 },
    },
  },
};

const SEC_LEVELS = ["public", "internal", "restricted", "secret"];

export const securityView: View = {
  name: "security",
  kinds: ["trust-zone", "security-node", "asset", "actor-group", "actor", "external"],
  containerKinds: ["trust-zone", "actor-group"],
  legendNames: {
    "trust-zone": "Trust zone (sensitivity)",
    "security-node": "Filtering / security node",
    asset: "Sensitive asset",
    "actor-group": "Actor group",
    actor: "Actor",
    external: "Untrusted external",
  },
  legendNamesFr: {
    "trust-zone": "Zone de confiance (sensibilit\u00e9)",
    "security-node": "N\u0153ud de filtrage / s\u00e9curit\u00e9",
    asset: "Actif sensible",
    "actor-group": "Groupe d'acteurs",
    actor: "Acteur",
    external: "Externe non ma\u00eetris\u00e9",
  },
  bandTitles: {
    flows: "FLOWS",
    objects: "BUSINESS OBJECTS",
    legend: "LEGEND",
  },
  legendFlowLabel: "Security flow — cross-zone flows should be filtered and encrypted",
  legendFlowLabelFr:
    "Flux de s\u00e9curit\u00e9 — les flux inter-zones doivent \u00eatre filtr\u00e9s et chiffr\u00e9s",
  partitions: {},
  partitionByOrder: true,
  flowLabelRequired: {
    code: "E0203",
    message: "flow without a label",
    help: 'add a label describing the exchange: `A -> B : "\u2026" (TLS1.3)`',
  },
  flowTechRequired: null,
  flowTechRecommended: null,
  attrSpec: {
    kind: "trust-zone",
    values: SEC_LEVELS,
    code: "E0250",
    message: "trust zone without a valid sensitivity level",
    help: 'set a level in parentheses: `trust-zone DMZ "DMZ" (public)` — one of public, internal, restricted, secret',
  },
  trustOrder: { public: 0, internal: 1, restricted: 2, secret: 3 },
  boundaryLint: {
    code: "W0560",
    nodeKind: "security-node",
    message: "unfiltered trust-boundary crossing",
    help: "route this flow through a `security-node` (firewall/WAF/bastion), or confirm the direct path is intended",
  },
  crossZoneTechRecommended: {
    code: "W0561",
    message: "cross-zone flow without stated encryption/protocol",
    help: 'add the protocol/encryption on inter-zone flows: `A -> B : "\u2026" (TLS1.3)`',
  },
  nesting: [
    {
      code: "E0217",
      child: "asset",
      parents: ["trust-zone"],
      message: "sensitive asset outside any trust zone",
      help: "move this `asset` inside a `trust-zone`",
    },
    {
      code: "E0218",
      child: "security-node",
      parents: ["trust-zone"],
      message: "security node outside any trust zone",
      help: "place this `security-node` inside a `trust-zone` (typically the exposed one it protects)",
    },
    {
      code: "E0211",
      child: "actor",
      parents: ["actor-group"],
      message: "actor outside any group",
      help: "move this `actor` inside an `actor-group`",
    },
  ],
  minCounts: [],
  isolatedWarn: {
    code: "W0510",
    kinds: ["asset"],
    message: "isolated element: no incoming or outgoing flow",
  },
  defaults: {
    "trust-zone": {
      fill: "#f5f5f4",
      stroke: { color: "#8a8a85", style: "solid", width: 1.3 },
    },
    "security-node": {
      fill: "#fff7e6",
      stroke: { color: "#c46b2a", style: "solid", width: 1.6 },
    },
    asset: {
      fill: "#ffffff",
      stroke: { color: "#55606b", style: "solid", width: 1.3 },
    },
    "actor-group": {
      fill: "#eef4fb",
      stroke: { color: "#7a9cc4", style: "dashed", width: 1.2 },
    },
    external: {
      fill: "#fdecea",
      stroke: { color: "#d9534f", style: "dashed", width: 1.3 },
    },
    actor: {},
  },
  defaultsDark: {
    "trust-zone": {
      fill: "#26261f",
      stroke: { color: "#8a8a72", style: "solid", width: 1.3 },
    },
    "security-node": {
      fill: "#2e2717",
      stroke: { color: "#c46b2a", style: "solid", width: 1.6 },
    },
    asset: {
      fill: "#252a31",
      stroke: { color: "#6b7885", style: "solid", width: 1.3 },
    },
    "actor-group": {
      fill: "#232a33",
      stroke: { color: "#5c7fa8", style: "dashed", width: 1.2 },
    },
    external: {
      fill: "#3a2422",
      stroke: { color: "#c25a54", style: "dashed", width: 1.3 },
    },
    actor: {},
  },
  levelDefaults: {
    public: {
      fill: "#fdecea",
      stroke: { color: "#d9534f", style: "solid", width: 1.4 },
    },
    internal: {
      fill: "#fff4e5",
      stroke: { color: "#e0a458", style: "solid", width: 1.4 },
    },
    restricted: {
      fill: "#e8f1f8",
      stroke: { color: "#5b8db8", style: "solid", width: 1.4 },
    },
    secret: {
      fill: "#ece8f5",
      stroke: { color: "#7a5fae", style: "solid", width: 1.4 },
    },
  },
  levelDefaultsDark: {
    public: {
      fill: "#3a2422",
      stroke: { color: "#c25a54", style: "solid", width: 1.4 },
    },
    internal: {
      fill: "#332a1c",
      stroke: { color: "#c08a44", style: "solid", width: 1.4 },
    },
    restricted: {
      fill: "#1f2a33",
      stroke: { color: "#4a7ba6", style: "solid", width: 1.4 },
    },
    secret: {
      fill: "#2a2433",
      stroke: { color: "#7a5f9e", style: "solid", width: 1.4 },
    },
  },
};

export const views: Record<string, View> = {
  logical: logicalView,
  application: applicationView,
  infrastructure: infrastructureView,
  security: securityView,
};
