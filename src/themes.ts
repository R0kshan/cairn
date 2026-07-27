/**
 * Colour system: named palettes (light, dark, slate, nord, …), the per-kind and
 * per-trust-level default styles, and `themeFor`/`mkTheme`/`flowPalette` that
 * resolve a theme for a given view. Consumed by the renderer and the flow-matrix
 * SVG exporter. Adding or retinting a theme happens here.
 */

import type { StyleProps } from "./models/ast.ts";
import type { View } from "./views.ts";

export interface Palette {
  background: string;
  containerLabel: string;
  containerFill: string;
  containerStroke: string;
  nodeText: string;
  nodeFill: string;
  nodeStroke: string;
  actorStroke: string;
  actorText: string;
  edge: string;
  edgeLabel: string;
  techText: string;
  halo: string;
  bandTitle: string;
  bandText: string;
  bandMuted: string;
  divider: string;
  badgeFill: string;
  badgeStroke: string;
  chipFill: string;
  chipStroke: string;
  chipText: string;
}

export const lightPalette: Palette = {
  background: "white",
  containerLabel: "#333",
  containerFill: "#f7f7f7",
  containerStroke: "#999",
  nodeText: "#222233",
  nodeFill: "white",
  nodeStroke: "#667",
  actorStroke: "#445566",
  actorText: "#223344",
  edge: "#444444",
  edgeLabel: "#333",
  techText: "#777",
  halo: "white",
  bandTitle: "#555",
  bandText: "#444",
  bandMuted: "#666",
  divider: "#ddd",
  badgeFill: "white",
  badgeStroke: "#888",
  chipFill: "#fdf3d8",
  chipStroke: "#c9a227",
  chipText: "#7a6216",
};

export const darkPalette: Palette = {
  background: "#1e2227",
  containerLabel: "#e6edf3",
  containerFill: "#2a2f37",
  containerStroke: "#4a5560",
  nodeText: "#e6edf3",
  nodeFill: "#252a31",
  nodeStroke: "#5a6673",
  actorStroke: "#8aa0b8",
  actorText: "#c9d5e1",
  edge: "#9aa7b4",
  edgeLabel: "#d6dde4",
  techText: "#9aa7b4",
  halo: "#1e2227",
  bandTitle: "#b7c2cd",
  bandText: "#c2ccd6",
  bandMuted: "#93a0ab",
  divider: "#3a4149",
  badgeFill: "#252a31",
  badgeStroke: "#5a6673",
  chipFill: "#3a3320",
  chipStroke: "#b08d2a",
  chipText: "#e0c068",
};

export const palettes: Record<string, Palette> = {
  light: lightPalette,
  dark: darkPalette,
};

export const flowPalette: Record<"light" | "dark", string[]> = {
  light: [
    "#1f77b4",
    "#d62728",
    "#2e8b57",
    "#9467bd",
    "#8c564b",
    "#c1288a",
    "#0e8ea6",
    "#9a9a1e",
    "#e07b00",
    "#5a5a5a",
  ],
  dark: [
    "#5fa8dc",
    "#f2695f",
    "#63c98a",
    "#b79ae0",
    "#c08a76",
    "#e878bd",
    "#4fc4d6",
    "#cfcf5a",
    "#f2a24e",
    "#a6a6a6",
  ],
};

export interface Theme {
  palette: Palette;
  roles: Record<string, StyleProps>;
  levels: Record<string, StyleProps>;
}

interface ThemeSpec {
  pal: {
    bg: string;
    text: string;
    sub: string;
    muted: string;
    cFill: string;
    cStroke: string;
    nFill: string;
    nStroke: string;
    edge: string;
    div: string;
    halo: string;
    aStroke: string;
    aText: string;
    chip: [string, string, string];
    badge: [string, string];
  };
  accentColors: Record<string, string>;
  lv: Record<string, [string, string]>;
}

const containerStyle = (fill: string, stroke: string, dashed = false, width = 1.2): StyleProps => ({
  fill,
  stroke: { color: stroke, style: dashed ? "dashed" : "solid", width },
});

const leafStyle = (fill: string, stroke: string, width = 1.3): StyleProps => ({
  fill,
  stroke: { color: stroke, style: "solid", width },
});

const KIND_ROLE_MAP: Record<string, string> = {
  "actor-group": "actorGroup",
  actor: "actor",
  system: "system",
  application: "application",
  module: "leaf",
  layer: "layer",
  block: "leaf",
  external: "external",
  datastore: "datastore",
  queue: "datastore",
  gateway: "authGateway",
  auth: "auth",
  idp: "identityProvider",
  site: "site",
  "network-zone": "networkZone",
  server: "server",
  "app-instance": "appInstance",
  "security-node": "securityNode",
  asset: "leaf",
};

const roleForKind = (kind: string, viewName: string): string =>
  viewName === "security" && kind === "external" ? "untrusted" : (KIND_ROLE_MAP[kind] ?? "leaf");

const buildTheme = (spec: ThemeSpec): Theme => {
  const paletteSpec = spec.pal,
    accentColors = spec.accentColors;
  const palette: Palette = {
    background: paletteSpec.bg,
    containerLabel: paletteSpec.text,
    containerFill: paletteSpec.cFill,
    containerStroke: paletteSpec.cStroke,
    nodeText: paletteSpec.text,
    nodeFill: paletteSpec.nFill,
    nodeStroke: paletteSpec.nStroke,
    actorStroke: paletteSpec.aStroke,
    actorText: paletteSpec.aText,
    edge: paletteSpec.edge,
    edgeLabel: paletteSpec.sub,
    techText: paletteSpec.muted,
    halo: paletteSpec.halo,
    bandTitle: paletteSpec.sub,
    bandText: paletteSpec.text,
    bandMuted: paletteSpec.muted,
    divider: paletteSpec.div,
    badgeFill: paletteSpec.badge[0],
    badgeStroke: paletteSpec.badge[1],
    chipFill: paletteSpec.chip[0],
    chipStroke: paletteSpec.chip[1],
    chipText: paletteSpec.chip[2],
  };
  return {
    palette,
    roles: {
      actor: {},
      actorGroup: containerStyle(accentColors.blueF, accentColors.blue, true),
      system: containerStyle(accentColors.amberF, accentColors.amber),
      application: containerStyle(accentColors.appF, accentColors.app),
      layer: containerStyle(accentColors.goldF, accentColors.gold, false, 1),
      external: containerStyle(accentColors.violetF, accentColors.violet, true),
      untrusted: containerStyle(accentColors.redF, accentColors.red, true, 1.3),
      leaf: leafStyle(accentColors.leafF, accentColors.leafS),
      datastore: leafStyle(accentColors.purpleF, accentColors.purple),
      site: containerStyle(accentColors.siteF, accentColors.siteS, false, 1.4),
      networkZone: containerStyle(accentColors.greenF, accentColors.green, true),
      server: containerStyle(accentColors.serverF, accentColors.serverS, false, 1.5),
      appInstance: leafStyle(accentColors.aiF, accentColors.aiS, 1.2),
      securityNode: leafStyle(accentColors.nodeF, accentColors.node, 1.6),
      authGateway: leafStyle(accentColors.authF, accentColors.auth, 1.4),
      auth: leafStyle(accentColors.nodeF, accentColors.node, 1.5),
      identityProvider: leafStyle(accentColors.idpF, accentColors.idp),
    },
    levels: {
      public: containerStyle(spec.lv.public[0], spec.lv.public[1], false, 1.4),
      internal: containerStyle(spec.lv.internal[0], spec.lv.internal[1], false, 1.4),
      restricted: containerStyle(spec.lv.restricted[0], spec.lv.restricted[1], false, 1.4),
      secret: containerStyle(spec.lv.secret[0], spec.lv.secret[1], false, 1.4),
    },
  };
};

export const themes: Record<string, Theme> = {
  light: buildTheme({
    pal: {
      bg: "#ffffff",
      text: "#17202c",
      sub: "#3a4553",
      muted: "#79828f",
      cFill: "#f5f6f8",
      cStroke: "#c7ccd3",
      nFill: "#ffffff",
      nStroke: "#48546a",
      edge: "#5a6675",
      div: "#e6e9ee",
      halo: "#ffffff",
      aStroke: "#1f5e91",
      aText: "#20364c",
      chip: ["#fff2d4", "#d3a01f", "#6a5111"],
      badge: ["#ffffff", "#8a94a2"],
    },
    accentColors: {
      blue: "#1f77b4",
      blueF: "#e9f2fb",
      amber: "#c17d1c",
      amberF: "#fbf4e9",
      app: "#2f83b6",
      appF: "#e9f3fa",
      gold: "#cf9f2f",
      goldF: "#fdfaf0",
      violet: "#8659a6",
      violetF: "#f4eff8",
      red: "#cf4b3f",
      redF: "#fdecea",
      purple: "#8a53a8",
      purpleF: "#f4edf8",
      green: "#1a8f66",
      greenF: "#eaf5ef",
      siteS: "#7c8794",
      siteF: "#f3f5f6",
      leafF: "#ffffff",
      leafS: "#48546a",
      aiS: "#c88a2e",
      aiF: "#fdf4e3",
      node: "#d1600f",
      nodeF: "#fdefe3",
      serverS: "#48546a",
      serverF: "#ffffff",
      auth: "#b85a30",
      authF: "#f5e6dd",
      idp: "#3a8f8f",
      idpF: "#e0f0f0",
    },
    lv: {
      public: ["#fdeceb", "#d0463f"],
      internal: ["#fef2e2", "#cf9436"],
      restricted: ["#e9f2fb", "#2f7cc4"],
      secret: ["#efe9f7", "#7a55a8"],
    },
  }),
  dark: buildTheme({
    pal: {
      bg: "#1e2530",
      text: "#e6edf3",
      sub: "#c2ccd6",
      muted: "#93a0ab",
      cFill: "#2a313c",
      cStroke: "#4a5560",
      nFill: "#252c37",
      nStroke: "#5a6673",
      edge: "#9aa7b4",
      div: "#3a4149",
      halo: "#1e2530",
      aStroke: "#8aa0b8",
      aText: "#c9d5e1",
      chip: ["#3a3320", "#b08d2a", "#e0c068"],
      badge: ["#252c37", "#5a6673"],
    },
    accentColors: {
      blue: "#5aa9e6",
      blueF: "#233242",
      amber: "#e0a955",
      amberF: "#332a1b",
      app: "#5aa9e6",
      appF: "#1f2a37",
      gold: "#d8c15f",
      goldF: "#2e2a1a",
      violet: "#b48ad6",
      violetF: "#2a2436",
      red: "#e0736a",
      redF: "#3a2422",
      purple: "#c085d8",
      purpleF: "#291f33",
      green: "#4fc08a",
      greenF: "#1c2b23",
      siteS: "#8a95a2",
      siteF: "#282d34",
      leafF: "#252c37",
      leafS: "#6b7885",
      aiS: "#e0a955",
      aiF: "#2e2717",
      node: "#f0894e",
      nodeF: "#33261c",
      serverS: "#6b7885",
      serverF: "#252c37",
      auth: "#c96a4a",
      authF: "#332218",
      idp: "#4fafaf",
      idpF: "#1a2e2e",
    },
    lv: {
      public: ["#3a2422", "#c25a54"],
      internal: ["#332a1c", "#c08a44"],
      restricted: ["#1f2a37", "#4a86b8"],
      secret: ["#291f33", "#8a6cb0"],
    },
  }),
  slate: buildTheme({
    pal: {
      bg: "#f7f9fb",
      text: "#26303c",
      sub: "#465264",
      muted: "#8792a0",
      cFill: "#eef2f6",
      cStroke: "#c2ccd6",
      nFill: "#ffffff",
      nStroke: "#516070",
      edge: "#5b6673",
      div: "#e0e6ec",
      halo: "#f7f9fb",
      aStroke: "#3b6ea5",
      aText: "#2b4560",
      chip: ["#eaeef3", "#8595a8", "#48566a"],
      badge: ["#ffffff", "#93a0b0"],
    },
    accentColors: {
      blue: "#3b6ea5",
      blueF: "#e8eff6",
      amber: "#5b7a99",
      amberF: "#eef2f6",
      app: "#3b6ea5",
      appF: "#e8eff6",
      gold: "#7a94ad",
      goldF: "#f0f3f6",
      violet: "#7d6ba8",
      violetF: "#efecf5",
      red: "#b5544a",
      redF: "#f7ebe9",
      purple: "#8a6fae",
      purpleF: "#efecf6",
      green: "#4a8f8a",
      greenF: "#e9f2f1",
      siteS: "#8792a0",
      siteF: "#eef1f4",
      leafF: "#ffffff",
      leafS: "#516070",
      aiS: "#6f86a0",
      aiF: "#eef2f6",
      node: "#c0603a",
      nodeF: "#f8ece7",
      serverS: "#516070",
      serverF: "#ffffff",
      auth: "#a85a30",
      authF: "#f0e4dd",
      idp: "#3a8f8f",
      idpF: "#e4f0f0",
    },
    lv: {
      public: ["#f7ece9", "#c05a4a"],
      internal: ["#f3efe6", "#a8823f"],
      restricted: ["#e8eff6", "#3b6ea5"],
      secret: ["#efecf5", "#7d6ba8"],
    },
  }),
  sand: buildTheme({
    pal: {
      bg: "#faf6ee",
      text: "#3a2f22",
      sub: "#5c4c38",
      muted: "#8a795f",
      cFill: "#f2ebdd",
      cStroke: "#cdbfa3",
      nFill: "#fffdf8",
      nStroke: "#6b5d48",
      edge: "#6b5d48",
      div: "#e6dcc9",
      halo: "#faf6ee",
      aStroke: "#3f7a8c",
      aText: "#274852",
      chip: ["#f4e6c8", "#c19a3f", "#6b5417"],
      badge: ["#fffdf8", "#b3a488"],
    },
    accentColors: {
      blue: "#3f7a8c",
      blueF: "#e6f0f1",
      amber: "#b07d2a",
      amberF: "#f6ecd8",
      app: "#3f7a8c",
      appF: "#e6f0f1",
      gold: "#c99f45",
      goldF: "#f8f0dd",
      violet: "#9c6f4a",
      violetF: "#f1e9df",
      red: "#c0562a",
      redF: "#f7e6da",
      purple: "#8a5f7a",
      purpleF: "#f2e8ee",
      green: "#6f8f4a",
      greenF: "#eef2e2",
      siteS: "#8a795f",
      siteF: "#f2ecdf",
      leafF: "#fffdf8",
      leafS: "#6b5d48",
      aiS: "#b07d2a",
      aiF: "#f7efe0",
      node: "#c0562a",
      nodeF: "#f7e6da",
      serverS: "#6b5d48",
      serverF: "#fffdf8",
      auth: "#a85a30",
      authF: "#f0e5dd",
      idp: "#3a7a6f",
      idpF: "#e5f0ed",
    },
    lv: {
      public: ["#f7e2da", "#c0562a"],
      internal: ["#f6ecd2", "#b0842e"],
      restricted: ["#e6f0f1", "#3f7a8c"],
      secret: ["#f0e8ef", "#8a5f7a"],
    },
  }),
  contrast: buildTheme({
    pal: {
      bg: "#ffffff",
      text: "#000000",
      sub: "#1a1a1a",
      muted: "#3a3a3a",
      cFill: "#f2f2f2",
      cStroke: "#333333",
      nFill: "#ffffff",
      nStroke: "#111111",
      edge: "#1a1a1a",
      div: "#cccccc",
      halo: "#ffffff",
      aStroke: "#003a66",
      aText: "#000000",
      chip: ["#ffe9b0", "#8a6d00", "#3a2e00"],
      badge: ["#ffffff", "#333333"],
    },
    accentColors: {
      blue: "#005a9c",
      blueF: "#e0edf7",
      amber: "#9a4a00",
      amberF: "#f6e9dd",
      app: "#005a9c",
      appF: "#e0edf7",
      gold: "#8a6d00",
      goldF: "#f6f0da",
      violet: "#6a2fa0",
      violetF: "#eee4f7",
      red: "#c0341a",
      redF: "#f9e2dd",
      purple: "#8a1a6a",
      purpleF: "#f7e0ef",
      green: "#00695c",
      greenF: "#daf0ec",
      siteS: "#333333",
      siteF: "#eeeeee",
      leafF: "#ffffff",
      leafS: "#111111",
      aiS: "#9a4a00",
      aiF: "#f6e9dd",
      node: "#c0341a",
      nodeF: "#f9e2dd",
      serverS: "#111111",
      serverF: "#ffffff",
      auth: "#993a1a",
      authF: "#f6e3dd",
      idp: "#005a5a",
      idpF: "#daf0f0",
    },
    lv: {
      public: ["#f9dcd6", "#c0341a"],
      internal: ["#f6e6c8", "#9a6a00"],
      restricted: ["#e0edf7", "#005a9c"],
      secret: ["#eee0f7", "#6a2fa0"],
    },
  }),
  nord: buildTheme({
    pal: {
      bg: "#2e3440",
      text: "#eceff4",
      sub: "#d8dee9",
      muted: "#9aa3b2",
      cFill: "#3b4252",
      cStroke: "#4c566a",
      nFill: "#3b4252",
      nStroke: "#4c566a",
      edge: "#abb2bf",
      div: "#434c5e",
      halo: "#2e3440",
      aStroke: "#88c0d0",
      aText: "#e5e9f0",
      chip: ["#3b3a2a", "#ebcb8b", "#ebcb8b"],
      badge: ["#3b4252", "#4c566a"],
    },
    accentColors: {
      blue: "#81a1c1",
      blueF: "#333b4a",
      amber: "#ebcb8b",
      amberF: "#3a3524",
      app: "#81a1c1",
      appF: "#2f3a44",
      gold: "#d0b47a",
      goldF: "#37331f",
      violet: "#b48ead",
      violetF: "#352d38",
      red: "#bf616a",
      redF: "#3a2a2d",
      purple: "#a38bbd",
      purpleF: "#312a3a",
      green: "#8fbcbb",
      greenF: "#26332f",
      siteS: "#9aa3b2",
      siteF: "#353c49",
      leafF: "#3b4252",
      leafS: "#5a6377",
      aiS: "#ebcb8b",
      aiF: "#3a3524",
      node: "#d08770",
      nodeF: "#372a24",
      serverS: "#5a6377",
      serverF: "#3b4252",
      auth: "#c96a4a",
      authF: "#332218",
      idp: "#6fafaf",
      idpF: "#203432",
    },
    lv: {
      public: ["#3a2a2d", "#bf616a"],
      internal: ["#3a3524", "#d0a85f"],
      restricted: ["#2f3a44", "#81a1c1"],
      secret: ["#312a3a", "#a38bbd"],
    },
  }),
  solarized: buildTheme({
    pal: {
      bg: "#fdf6e3",
      text: "#586e75",
      sub: "#657b83",
      muted: "#93a1a1",
      cFill: "#eee8d5",
      cStroke: "#c9c1a8",
      nFill: "#fdf6e3",
      nStroke: "#93a1a1",
      edge: "#657b83",
      div: "#ded8c3",
      halo: "#fdf6e3",
      aStroke: "#268bd2",
      aText: "#073642",
      chip: ["#f2e9c8", "#b58900", "#5c4a00"],
      badge: ["#fdf6e3", "#b3aa90"],
    },
    accentColors: {
      blue: "#268bd2",
      blueF: "#e3edf3",
      amber: "#b58900",
      amberF: "#f2ecd6",
      app: "#268bd2",
      appF: "#e3edf3",
      gold: "#cb9b2e",
      goldF: "#f4eed6",
      violet: "#6c71c4",
      violetF: "#e8e6f2",
      red: "#dc322f",
      redF: "#f7e2d9",
      purple: "#d33682",
      purpleF: "#f6e0ea",
      green: "#2aa198",
      greenF: "#dff0ec",
      siteS: "#93a1a1",
      siteF: "#eee8d5",
      leafF: "#fdf6e3",
      leafS: "#657b83",
      aiS: "#b58900",
      aiF: "#f2ecd6",
      node: "#cb4b16",
      nodeF: "#f7e4d6",
      serverS: "#657b83",
      serverF: "#fdf6e3",
      auth: "#b85a30",
      authF: "#f5e6dd",
      idp: "#2aa198",
      idpF: "#dff0ec",
    },
    lv: {
      public: ["#f7ddd6", "#dc322f"],
      internal: ["#f2e6c8", "#b58900"],
      restricted: ["#e3edf3", "#268bd2"],
      secret: ["#e8e6f2", "#6c71c4"],
    },
  }),
};

export const themeNames: string[] = [...Object.keys(themes), "classic", "classic-dark"];

export function themeFor(
  name: string,
  view: View,
): {
  palette: Palette;
  kinds: Record<string, StyleProps>;
  levels: Record<string, StyleProps>;
} {
  if (name === "classic")
    return {
      palette: lightPalette,
      kinds: view.defaults,
      levels: view.levelDefaults ?? {},
    };
  if (name === "classic-dark")
    return {
      palette: darkPalette,
      kinds: view.defaultsDark,
      levels: view.levelDefaultsDark ?? {},
    };
  const theme = themes[name] ?? themes.light;
  const kinds: Record<string, StyleProps> = {};
  for (const kind of view.kinds) kinds[kind] = theme.roles[roleForKind(kind, view.name)] ?? {};
  return { palette: theme.palette, kinds, levels: theme.levels };
}
