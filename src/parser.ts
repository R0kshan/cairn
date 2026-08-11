/**
 * Stage 2: recursive-descent parser turning the token stream into a `Model`
 * (elements with nesting, flows, business objects, legend notes, style). Grammar
 * is `diagram <type> "Title"` then declarations; `applyStyleEntry` handles the
 * style DSL. Recovers from errors via `syncToNextLine` and reports them as
 * `E01xx` diagnostics, so a broken file still yields a partial model. Rejects the
 * reserved keys `__proto__`/`constructor`/`prototype` at parse time.
 */

import { lex } from "./lexer.ts";
import type { Token } from "./models/token.ts";
import type { Model, Element, Flow, StyleProps, DiagramStyle, Span } from "./models/ast.ts";
import type { Diagnostic } from "./models/diagnostic.ts";
import { defaultDiagramStyle } from "./models/ast.ts";
import { themeNames } from "./themes.ts";
import { indexElementsById } from "./element-tree.ts";

export function parse(src: string): { model: Model; diags: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const tokens = lex(src, diagnostics);
  let position = 0;

  const lookAhead = (offset = 0): Token => tokens[Math.min(position + offset, tokens.length - 1)];
  const matchToken = (kind: string, text?: string) =>
    lookAhead().kind === kind && (text === undefined || lookAhead().text === text);
  const advance = (): Token => tokens[position < tokens.length - 1 ? position++ : position];
  const skipNewlines = () => {
    while (matchToken("nl")) advance();
  };
  const reportError = (message: string, span: Span, help?: string) =>
    diagnostics.push({
      code: "E0101",
      severity: "error",
      message,
      span,
      help,
    });
  const syncToNextLine = () => {
    while (!matchToken("nl") && !matchToken("eof")) advance();
  };

  const model: Model = {
    elements: [],
    flows: [],
    businessObjects: [],
    legendNotes: [],
    style: defaultDiagramStyle(),
    index: new Map(),
  };
  let flowSequenceNumber = 0;

  skipNewlines();
  if (matchToken("id", "diagram")) {
    advance();
    if (matchToken("id")) {
      const token = advance();
      model.type = token.text;
      model.typeSpan = token.span;
    } else
      reportError(
        "diagram type expected after `diagram`",
        lookAhead().span,
        'e.g. `diagram logical "Title"`',
      );
    if (matchToken("str")) model.title = advance().text;
  } else {
    reportError(
      "missing `diagram <type>` header on the first line",
      lookAhead().span,
      'add `diagram logical "Title"` or scaffold a file with `cairn new --logical-architecture`',
    );
  }

  function parseStyleEntries(target: DiagramStyle | null, inline: StyleProps | null) {
    skipNewlines();
    while (!matchToken("rbrace") && !matchToken("eof")) {
      if (!matchToken("id")) {
        reportError("style property expected", lookAhead().span);
        syncToNextLine();
        skipNewlines();
        continue;
      }
      const keyToken = advance();
      let styleTargetKind: string | undefined;
      if (matchToken("id")) {
        const token = advance();
        if (
          token.text === "__proto__" ||
          token.text === "constructor" ||
          token.text === "prototype"
        ) {
          reportError(`\`${token.text}\` is a reserved name and can't be styled`, token.span);
          syncToNextLine();
          skipNewlines();
          continue;
        }
        styleTargetKind = token.text;
      }
      if (!matchToken("colon")) {
        reportError("`:` expected after the style property", lookAhead().span);
        syncToNextLine();
        skipNewlines();
        continue;
      }
      advance();
      const values: Token[] = [];
      while (!matchToken("nl") && !matchToken("rbrace") && !matchToken("eof")) {
        if (values.length && matchToken("id") && lookAhead(1).kind === "colon") break;
        values.push(advance());
      }
      applyStyleEntry(keyToken, styleTargetKind, values, target, inline, diagnostics);
      skipNewlines();
    }
    if (matchToken("rbrace")) advance();
    else reportError("`}` expected to close the style block", lookAhead().span);
  }

  function parseElementBody(parent: Element) {
    skipNewlines();
    while (!matchToken("rbrace") && !matchToken("eof")) {
      parseStatement(parent);
      skipNewlines();
    }
    if (matchToken("rbrace")) advance();
    else reportError("`}` expected to close `" + parent.id + "`", lookAhead().span);
  }

  /** `style { … }` at any nesting level. Backtracks if `style` isn't
   *  actually followed by a block, so `style` stays usable as an id elsewhere. */
  function tryStyleBlock(parent: Element | null): boolean {
    if (!matchToken("id", "style")) return false;
    const savedPosition = position;
    advance();
    if (!matchToken("lbrace")) {
      position = savedPosition;
      return false;
    }
    advance();
    if (parent) {
      parent.style = parent.style ?? {};
      parseStyleEntries(null, parent.style);
    } else parseStyleEntries(model.style, null);
    return true;
  }

  /** Top-level `legend { note "…" … }`. Backtracks for the same reason as
   *  `tryStyleBlock`. */
  function tryLegendBlock(): boolean {
    if (!matchToken("id", "legend")) return false;
    const savedPosition = position;
    advance();
    if (!matchToken("lbrace")) {
      position = savedPosition;
      return false;
    }
    advance();
    skipNewlines();
    while (!matchToken("rbrace") && !matchToken("eof")) {
      if (matchToken("id", "note")) {
        advance();
        if (matchToken("str")) model.legendNotes.push(advance().text);
        else
          reportError(
            "text expected after `note`",
            lookAhead().span,
            'e.g. `note "Named-data flows are subject to GDPR"`',
          );
      } else {
        reportError('legend entries are `note "…"` lines', lookAhead().span);
        syncToNextLine();
      }
      skipNewlines();
    }
    if (matchToken("rbrace")) advance();
    else reportError("`}` expected to close the legend block", lookAhead().span);
    return true;
  }

  /** Top-level `business-object ID "name" "description"`. No backtrack: once
   *  the keyword matches, the line commits to this shape. */
  function tryBusinessObject(): boolean {
    if (!matchToken("id", "business-object")) return false;
    advance();
    if (!matchToken("id")) {
      reportError(
        "identifier expected after `business-object`",
        lookAhead().span,
        'e.g. `business-object BO_CMD "Commande" "description"`',
      );
      syncToNextLine();
      return true;
    }
    const idToken = advance();
    let name = idToken.text,
      description: string | undefined;
    if (matchToken("str")) name = advance().text;
    if (matchToken("str")) description = advance().text;
    model.businessObjects.push({
      id: idToken.text,
      idSpan: idToken.span,
      name,
      description,
    });
    return true;
  }

  /** `ID -> ID : "label" (tech) [objects] { style }`, everything after the
   *  arrow optional. `sourceToken` is already consumed by the caller. */
  function parseFlow(sourceToken: Token): void {
    advance();
    if (!matchToken("id")) {
      reportError("target identifier expected after `->`", lookAhead().span);
      syncToNextLine();
      return;
    }
    const targetToken = advance();
    const flow: Flow = {
      id: "F" + String(++flowSequenceNumber).padStart(2, "0"),
      from: sourceToken.text,
      fromSpan: sourceToken.span,
      to: targetToken.text,
      toSpan: targetToken.span,
      span: {
        line: sourceToken.span.line,
        col: sourceToken.span.col,
        len: targetToken.span.col + targetToken.span.len - sourceToken.span.col,
      },
    };
    if (matchToken("colon")) {
      advance();
      if (matchToken("str")) flow.label = advance().text;
      else if (
        !matchToken("lparen") &&
        !matchToken("lbrack") &&
        !matchToken("lbrace") &&
        !matchToken("nl") &&
        !matchToken("rbrace") &&
        !matchToken("eof")
      ) {
        reportError(
          "flow label expected after `:`",
          lookAhead().span,
          'give a `"label"`, or omit it: `A -> B : (HTTPS/443)`',
        );
      }
    }
    if (matchToken("lparen")) {
      const openParen = advance();
      const values: string[] = [];
      while ((matchToken("id") || matchToken("num") || matchToken("str")) && values.length < 2) {
        values.push(advance().text);
        if (matchToken("comma")) advance();
      }
      if (matchToken("rparen")) advance();
      else
        reportError(
          "`)` expected to close the technical attributes",
          lookAhead().span,
          'e.g. `A -> B : "Envoi" (SFTP, XML)`',
        );
      flow.tech = {
        protocol: values[0],
        format: values[1],
        span: openParen.span,
      };
    }
    if (matchToken("lbrack")) {
      advance();
      flow.objects = [];
      while (matchToken("id")) {
        const token = advance();
        flow.objects.push({ id: token.text, span: token.span });
        if (matchToken("comma")) advance();
      }
      if (matchToken("rbrack")) advance();
      else
        reportError(
          "`]` expected to close the business-object list",
          lookAhead().span,
          'e.g. `A -> B : "Validation" [BO_CMD]`',
        );
    }
    if (matchToken("lbrace")) {
      advance();
      flow.style = {};
      parseStyleEntries(null, flow.style);
    }
    model.flows.push(flow);
  }

  /** `<kind> ID "label" (attr) { … }`, everything after the id optional.
   *  `sourceToken` (the kind) is already consumed by the caller. */
  function parseElement(sourceToken: Token, parent: Element | null): void {
    if (!matchToken("id")) {
      reportError(
        `invalid declaration: \`${sourceToken.text}\` alone on this line`,
        sourceToken.span,
        'an element reads `<kind> <ID> "Label"`, a flow `<ID> -> <ID> : "label"`',
      );
      syncToNextLine();
      return;
    }
    const identifierToken = advance();
    const element: Element = {
      kind: sourceToken.text,
      kindSpan: sourceToken.span,
      id: identifierToken.text,
      idSpan: identifierToken.span,
      children: [],
      parent: parent ?? undefined,
    };
    if (matchToken("str")) element.label = advance().text;
    if (matchToken("lparen")) {
      advance();
      if (matchToken("id")) {
        const token = advance();
        element.attr = {
          value: token.text,
          span: token.span,
        };
      } else
        reportError(
          "attribute value expected after `(`",
          lookAhead().span,
          'e.g. `trust-zone DMZ "DMZ" (public)`',
        );
      if (matchToken("rparen")) advance();
      else
        reportError(
          "`)` expected to close the attribute",
          lookAhead().span,
          'e.g. `trust-zone DMZ "DMZ" (public)`',
        );
    }
    if (matchToken("lbrace")) {
      advance();
      parseElementBody(element);
    }
    (parent ? parent.children : model.elements).push(element);
  }

  /** Everything else: `ID -> ID : …` flows and `<kind> ID "label" { … }`
   *  elements. The two share their leading identifier, so they are one
   *  grammar production, not two. */
  function parseFlowOrElement(parent: Element | null): void {
    if (!matchToken("id")) {
      reportError("declaration expected (element, flow or `style`)", lookAhead().span);
      syncToNextLine();
      return;
    }
    const sourceToken = advance();
    if (matchToken("arrow")) parseFlow(sourceToken);
    else parseElement(sourceToken, parent);
  }

  function parseStatement(parent: Element | null) {
    if (matchToken("nl")) {
      advance();
      return;
    }
    if (tryStyleBlock(parent)) return;
    if (!parent && tryLegendBlock()) return;
    if (!parent && tryBusinessObject()) return;
    parseFlowOrElement(parent);
  }

  skipNewlines();
  while (!matchToken("eof")) {
    parseStatement(null);
    skipNewlines();
  }

  for (const [id, element] of indexElementsById(model.elements)) {
    if (!model.index.has(id)) model.index.set(id, element);
  }

  return { model, diags: diagnostics };
}

const LINE_STYLES = new Set(["solid", "dashed", "dotted"]);
const LABEL_POSITIONS = new Set(["on-line", "above", "below"]);
const DISPOSITIONS = new Set(["wide", "tall", "slide", "page"]);

/** The shape every uniform-looking `key: value` style property shares:
 *  read one token of the given kind, check it against an allowed set (if
 *  any), assign it or report the expected form. Properties that don't fit —
 *  multi-token values, side effects, or a nested `kind` target — stay as
 *  explicit `switch` cases below. */
interface UniformStyleEntry {
  kind: "id" | "color";
  allowed?: ReadonlySet<string>;
  assign: (target: DiagramStyle, value: Token) => void;
  expected: string;
}

const UNIFORM_STYLE_ENTRIES: Record<string, UniformStyleEntry> = {
  "crossing-hops": {
    kind: "id",
    allowed: new Set(["on", "off"]),
    assign: (target, value) => {
      target.crossingHops = value.text === "on";
    },
    expected: "`on` or `off`",
  },
  compact: {
    kind: "id",
    allowed: new Set(["on", "off"]),
    assign: (target, value) => {
      target.compact = value.text === "on";
    },
    expected: "`on` or `off`",
  },
  arrows: {
    kind: "id",
    allowed: new Set(["normal", "large"]),
    assign: (target, value) => {
      target.arrows = value.text as DiagramStyle["arrows"];
    },
    expected: "`normal` or `large`",
  },
  "flow-color": {
    kind: "id",
    allowed: new Set(["none", "by-source"]),
    assign: (target, value) => {
      target.flowColor = value.text as DiagramStyle["flowColor"];
    },
    expected: "`none` or `by-source`",
  },
  disposition: {
    kind: "id",
    allowed: DISPOSITIONS,
    assign: (target, value) => {
      target.disposition = value.text as DiagramStyle["disposition"];
    },
    expected:
      "`wide` (elongated horizontal), `tall` (elongated vertical), `slide` (balanced 16:9), `page` (balanced A4 portrait)",
  },
  legend: {
    kind: "id",
    allowed: new Set(["auto", "off"]),
    assign: (target, value) => {
      target.legend = value.text as DiagramStyle["legend"];
    },
    expected: "`auto` or `off`",
  },
  "flow-text": {
    kind: "id",
    allowed: new Set(["full", "numbered"]),
    assign: (target, value) => {
      target.flowText = value.text as DiagramStyle["flowText"];
    },
    expected:
      "`full` (labels on arrows) or `numbered` (number badges + FLUX table below the diagram)",
  },
  "flow-label": {
    kind: "id",
    allowed: LABEL_POSITIONS,
    assign: (target, value) => {
      target.flowLabel = value.text as DiagramStyle["flowLabel"];
    },
    expected: "`on-line`, `above` or `below`",
  },
  theme: {
    kind: "id",
    allowed: new Set(themeNames),
    assign: (target, value) => {
      target.theme = value.text;
    },
    expected: "`" + themeNames.join("` | `") + "`",
  },
  accent: {
    kind: "color",
    assign: (target, value) => {
      target.accent = value.text;
    },
    expected: "`#hex` color (retints flows on top of the theme)",
  },
  lang: {
    kind: "id",
    allowed: new Set(["en", "fr"]),
    assign: (target, value) => {
      target.lang = value.text as DiagramStyle["lang"];
    },
    expected: "`en` or `fr` (localizes rendered labels; keywords stay English)",
  },
  background: {
    kind: "color",
    assign: (target, value) => {
      target.background = value.text;
    },
    expected: "`#hex` color (canvas background)",
  },
};

function applyStyleEntry(
  key: Token,
  styleTargetKind: string | undefined,
  values: Token[],
  target: DiagramStyle | null,
  inline: StyleProps | null,
  diagnostics: Diagnostic[],
) {
  const extractStroke = (tokens: Token[], _span: Span): NonNullable<StyleProps["stroke"]> => {
    const strokeProps: NonNullable<StyleProps["stroke"]> = {};
    for (const token of tokens) {
      if (token.kind === "color") {
        if (strokeProps.color) reportDuplicate(token);
        strokeProps.color = token.text;
      } else if (token.kind === "num") {
        if (strokeProps.width) reportDuplicate(token);
        strokeProps.width = parseFloat(token.text);
      } else if (token.kind === "id" && LINE_STYLES.has(token.text)) {
        if (strokeProps.style) reportDuplicate(token);
        strokeProps.style = token.text as NonNullable<StyleProps["stroke"]>["style"];
      } else
        reportBadValue(token, "`#hex` color, `solid|dashed|dotted` line style, or numeric width");
    }
    return strokeProps;
  };
  const reportDuplicate = (value: Token) =>
    diagnostics.push({
      code: "E0102",
      severity: "error",
      message: `conflicting values in \`${key.text}\` : \`${value.text}\``,
      span: value.span,
      help: "only one value of each type per property",
    });
  const reportBadValue = (value: Token, expected: string) =>
    diagnostics.push({
      code: "E0103",
      severity: "error",
      message: `invalid value \`${value.text}\` for \`${key.text}\``,
      span: value.span,
      help: `expected: ${expected}`,
    });
  const firstValue = () => values[0];

  const keyText = key.text;
  if (inline) {
    if (keyText === "fill" && firstValue()?.kind === "color") inline.fill = firstValue().text;
    else if (keyText === "stroke") inline.stroke = extractStroke(values, key.span);
    else if (keyText === "text" && firstValue()?.kind === "color") inline.text = firstValue().text;
    else if (
      keyText === "label" &&
      firstValue()?.kind === "id" &&
      LABEL_POSITIONS.has(firstValue().text)
    )
      inline.label = firstValue().text as StyleProps["label"];
    else
      diagnostics.push({
        code: "E0104",
        severity: "error",
        message: `unknown style property here: \`${keyText}\``,
        span: key.span,
        help: "inline properties: fill, stroke, text, label",
      });
    return;
  }
  if (!target) return;
  const uniform = UNIFORM_STYLE_ENTRIES[keyText];
  if (uniform) {
    const value = firstValue();
    if (value?.kind === uniform.kind && (!uniform.allowed || uniform.allowed.has(value.text)))
      uniform.assign(target, value);
    else reportBadValue(value ?? key, uniform.expected);
    return;
  }
  switch (keyText) {
    case "flow-stroke": {
      const stroke = extractStroke(values, key.span);
      target.flowStroke = { ...target.flowStroke, ...stroke };
      if (stroke.color) target.flowStrokeColorSet = true;
      break;
    }
    case "fill": {
      if (styleTargetKind && firstValue()?.kind === "color") {
        target.kind[styleTargetKind] = {
          ...target.kind[styleTargetKind],
          fill: firstValue().text,
        };
      } else reportBadValue(firstValue() ?? key, "`fill <kind>: #hex`");
      break;
    }
    case "stroke": {
      if (styleTargetKind)
        target.kind[styleTargetKind] = {
          ...target.kind[styleTargetKind],
          stroke: extractStroke(values, key.span),
        };
      else reportBadValue(firstValue() ?? key, "`stroke <kind>: #hex solid|dashed|dotted <width>`");
      break;
    }
    case "text": {
      if (styleTargetKind && firstValue()?.kind === "color") {
        target.kind[styleTargetKind] = {
          ...target.kind[styleTargetKind],
          text: firstValue().text,
        };
      } else reportBadValue(firstValue() ?? key, "`text <kind>: #hex`");
      break;
    }
    case "font": {
      for (const token of values) {
        if (token.kind === "str") target.font.family = token.text;
        else if (token.kind === "num") target.font.size = parseFloat(token.text);
        else reportBadValue(token, '`font: "Family" <size>`');
      }
      break;
    }
    case "font-size": {
      const value = firstValue();
      if (value?.kind === "num") target.font.size = parseFloat(value.text);
      else reportBadValue(value ?? key, "a number, e.g. `font-size: 14`");
      break;
    }
    default:
      diagnostics.push({
        code: "E0104",
        severity: "error",
        message: `unknown style property: \`${keyText}\``,
        span: key.span,
        help: "properties: theme, accent, lang, background, disposition, legend, flow-text, crossing-hops, compact, arrows, flow-color, flow-label, flow-stroke, fill <kind>, stroke <kind>, text <kind>, font, font-size",
      });
  }
}
