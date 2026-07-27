/**
 * UI string tables for rendered chrome (band titles, legend, flow-matrix column
 * headers) in English and French, selected by `style { lang }`. Only rendered
 * output localizes — the DSL keywords stay English.
 */

export interface UIStrings {
  flows: string;
  objects: string;
  legend: string;
  numberedSuffix: string;
  carriedByFlow: string;
  businessObject: string;
  matrix: {
    title: string;
    n: string;
    source: string;
    dest: string;
    proto: string;
    port: string;
    nature: string;
    zone: string;
  };
}

export const UI: Record<"en" | "fr", UIStrings> = {
  en: {
    flows: "FLOWS",
    objects: "BUSINESS OBJECTS",
    legend: "LEGEND",
    numberedSuffix: "numbered (text: FLOWS band)",
    carriedByFlow: "carried by the flow",
    businessObject: "Business object",
    matrix: {
      title: "TECHNICAL FLOW MATRIX",
      n: "No.",
      source: "Source",
      dest: "Destination",
      proto: "Protocol",
      port: "Port",
      nature: "Flow",
      zone: "zone",
    },
  },
  fr: {
    flows: "FLUX",
    objects: "OBJETS M\u00C9TIER",
    legend: "L\u00C9GENDE",
    numberedSuffix: "num\u00E9rot\u00E9 (texte : bande FLUX)",
    carriedByFlow: "port\u00E9 par le flux",
    businessObject: "Objet m\u00E9tier",
    matrix: {
      title: "MATRICE DES FLUX TECHNIQUES",
      n: "N\u00B0",
      source: "Source",
      dest: "Destination",
      proto: "Protocole",
      port: "Port",
      nature: "Nature du flux",
      zone: "zone",
    },
  },
};
