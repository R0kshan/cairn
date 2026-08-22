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
import type {
  Model,
  Element,
  Flow,
  StyleProps,
  DiagramStyle,
  Span,
  AttachSide,
} from "./models/ast.ts";
import type { Diagnostic } from "./models/diagnostic.ts";
import { defaultDiagramStyle, ATTACH_SIDES } from "./models/ast.ts";
import { themeNames } from "./themes.ts";
import { indexElementsById } from "./element-tree.ts";

/**
 * The parser's cursor and the productions that recurse back into it. Bundled so
 * the leaf productions can live at top level instead of nesting inside `parse`
 * — they mutate the shared cursor, so they cannot simply take copies.
 */
interface Parser {
  model: Model;
  lookAhead: (offset?: number) => Token;
  matchToken: (kind: string, text?: string) => boolean;
  advance: () => Token;
  skipNewlines: () => void;
  reportError: (message: string, span: Span, help?: string) => void;
  /** `reportError` for a production that owns a code other than `E0101`. */
  reportCoded: (code: string, message: string, span: Span, help?: string) => void;
  syncToNextLine: () => void;
  /** Cursor marks, for the keyword blocks that commit only once `{` follows. */
  save: () => number;
  restore: (mark: number) => void;
  /** Boxed so `parseFlow` can advance it — flow ids are assigned in source order. */
  flowSequence: { next: number };
  /** `ID.side` endpoints awaiting `resolveAttachSides` once the id index exists. */
  endpointSplits: EndpointSplit[];
  parseStyleEntries: (target: DiagramStyle | null, inline: StyleProps | null) => void;
  parseElementBody: (parent: Element) => void;
}

/** `ID -> ID : "label" (proto, format) [BO…] { … }`, everything after the target
 *  optional. `sourceToken` (the source id) is already consumed by the caller. */
function parseFlow(p: Parser, sourceToken: Token): void {
  const { matchToken, advance, reportError, lookAhead, syncToNextLine, model } = p;
  const arrowToken = advance();
  if (!matchToken("id")) {
    reportError("target identifier expected after `->`", lookAhead().span);
    syncToNextLine();
    return;
  }
  const targetToken = advance();
  const flow: Flow = {
    id: "F" + String(++p.flowSequence.next).padStart(2, "0"),
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
  if (arrowToken.text === "-->") flow.lineStyle = "dashed";
  else if (arrowToken.text === "..>") flow.lineStyle = "dotted";
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
    p.parseStyleEntries(null, flow.style);
  }
  for (const split of [
    splitEndpoint(sourceToken, flow, "from"),
    splitEndpoint(targetToken, flow, "to"),
  ])
    if (split) p.endpointSplits.push(split);
  model.flows.push(flow);
}

/** `<kind> ID "label" (attr) { … }`, everything after the id optional.
 *  `sourceToken` (the kind) is already consumed by the caller. */
function parseElement(p: Parser, sourceToken: Token, parent: Element | null): void {
  const { matchToken, advance, reportError, lookAhead, syncToNextLine, model } = p;
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
    p.parseElementBody(element);
  }
  (parent ? parent.children : model.elements).push(element);
}

/**
 * An endpoint written `ID.side` — `.` is a legal id character, so the split is
 * only a *candidate* here: `resolveAttachSides` decides against `model.index`
 * whether the whole text is an id or an id plus an attachment side.
 */
interface EndpointSplit {
  flow: Flow;
  role: "from" | "to";
  raw: string;
  rawSpan: Span;
  base: string;
  baseSpan: Span;
  side: string;
  sideSpan: Span;
}

/** Splits `ID.suffix` on the last `.`; null when there is no dot to split on. */
function splitEndpoint(token: Token, flow: Flow, role: "from" | "to"): EndpointSplit | null {
  const dot = token.text.lastIndexOf(".");
  if (dot <= 0 || dot === token.text.length - 1) return null;
  const base = token.text.slice(0, dot);
  const side = token.text.slice(dot + 1);
  return {
    flow,
    role,
    raw: token.text,
    rawSpan: token.span,
    base,
    baseSpan: { line: token.span.line, col: token.span.col, len: base.length },
    side,
    sideSpan: { line: token.span.line, col: token.span.col + dot + 1, len: side.length },
  };
}

/**
 * Decides, per endpoint written with a dot, whether it names an element or an
 * element plus an attachment side. A declared id always wins — an element may
 * legitimately be called `API.right` — so the side reading only applies when the
 * whole text is unknown and the base is known.
 */
function resolveAttachSides(
  splits: EndpointSplit[],
  model: Model,
  diagnostics: Diagnostic[],
): void {
  for (const split of splits) {
    if (model.index.has(split.raw)) {
      if (ATTACH_SIDES.includes(split.side as AttachSide))
        diagnostics.push({
          code: "W0571",
          severity: "warning",
          message: `\`${split.raw}\` is a declared element, so \`.${split.side}\` is not read as an attachment side`,
          span: split.rawSpan,
          note: "a declared id always wins over the `ID.side` reading",
          help: `rename the element if you meant to attach the flow to the ${split.side} side of \`${split.base}\``,
        });
      continue;
    }
    if (!model.index.has(split.base)) continue; // unknown either way — E0220 reports it
    const known = ATTACH_SIDES.includes(split.side as AttachSide);
    if (!known)
      diagnostics.push({
        code: "E0223",
        severity: "error",
        message: `unknown attachment side \`${split.side}\``,
        span: split.sideSpan,
        note: "sides are named as the diagram is read",
        help: "use `left`, `right`, `top` or `bottom`, e.g. `APP.right -> DB.left`",
      });
    // The endpoint is rebound to the base either way: with an unknown side the
    // element is still identified, so E0223 reports the real problem alone
    // instead of trailing an `unknown reference` for the same text.
    const side = known ? { value: split.side as AttachSide, span: split.sideSpan } : undefined;
    if (split.role === "from") {
      split.flow.from = split.base;
      split.flow.fromSpan = split.baseSpan;
      split.flow.fromSide = side;
    } else {
      split.flow.to = split.base;
      split.flow.toSpan = split.baseSpan;
      split.flow.toSide = side;
    }
  }
}

/** `order: <n>` inside an element body. Backtracks when `order` is not followed
 *  by a colon, so `order` stays usable as an id. Layout, not cosmetics — hence a
 *  statement of its own rather than a `style` property. */
function tryOrderEntry(p: Parser, parent: Element | null): boolean {
  const { matchToken, advance, reportCoded, save, restore, syncToNextLine } = p;
  if (!parent || !matchToken("id", "order")) return false;
  const mark = save();
  const keyToken = advance();
  if (!matchToken("colon")) {
    restore(mark);
    return false;
  }
  advance();
  const valueToken = matchToken("num") ? advance() : null;
  const value = valueToken ? Number(valueToken.text) : Number.NaN;
  if (!Number.isInteger(value) || value < 0) {
    reportCoded(
      "E0106",
      "`order` expects a whole number ≥ 0",
      (valueToken ?? keyToken).span,
      "e.g. `order: 1` — lower comes first in reading order",
    );
    syncToNextLine();
    return true;
  }
  parent.order = { value, span: valueToken!.span };
  return true;
}

/** Top-level `legend { note "…" }`. Backtracks when `legend` is not followed by
 *  a brace, so an element may still be called `legend`. */
function tryLegendBlock(p: Parser): boolean {
  const { matchToken, advance, reportError, lookAhead, skipNewlines, syncToNextLine, model } = p;
  if (!matchToken("id", "legend")) return false;
  const mark = p.save();
  advance();
  if (!matchToken("lbrace")) {
    p.restore(mark);
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

/** Top-level `business-object ID "name" "description"`. No backtrack: once the
 *  keyword matches, the line commits to this shape. */
function tryBusinessObject(p: Parser): boolean {
  const { matchToken, advance, reportError, lookAhead, syncToNextLine, model } = p;
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
  let name = idToken.text;
  let description: string | undefined;
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

/** Everything else: `ID -> ID : …` flows and `<kind> ID "label" { … }` elements.
 *  The two share their leading identifier, so they are one grammar production,
 *  not two. */
function parseFlowOrElement(p: Parser, parent: Element | null): void {
  if (!p.matchToken("id")) {
    p.reportError("declaration expected (element, flow or `style`)", p.lookAhead().span);
    p.syncToNextLine();
    return;
  }
  const sourceToken = p.advance();
  if (p.matchToken("arrow")) parseFlow(p, sourceToken);
  else parseElement(p, sourceToken, parent);
}

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
  const reportCoded = (code: string, message: string, span: Span, help?: string) =>
    diagnostics.push({
      code,
      severity: "error",
      message,
      span,
      help,
    });
  const reportError = (message: string, span: Span, help?: string) =>
    reportCoded("E0101", message, span, help);
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
  const flowSequence = { next: 0 };
  const endpointSplits: EndpointSplit[] = [];

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
      applyStyleEntry({ key: keyToken, styleTargetKind, values, target, inline, diagnostics });
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

  /** The cursor and the recursive productions handed to the top-level parsing
   *  functions extracted above. */
  const parser: Parser = {
    model,
    lookAhead,
    matchToken,
    advance,
    skipNewlines,
    reportError,
    reportCoded,
    syncToNextLine,
    save: () => position,
    restore: (mark: number) => {
      position = mark;
    },
    flowSequence,
    endpointSplits,
    parseStyleEntries,
    parseElementBody,
  };

  function parseStatement(parent: Element | null) {
    if (matchToken("nl")) {
      advance();
      return;
    }
    if (tryStyleBlock(parent)) return;
    if (tryOrderEntry(parser, parent)) return;
    if (!parent && tryLegendBlock(parser)) return;
    if (!parent && tryBusinessObject(parser)) return;
    parseFlowOrElement(parser, parent);
  }

  skipNewlines();
  while (!matchToken("eof")) {
    parseStatement(null);
    skipNewlines();
  }

  for (const [id, element] of indexElementsById(model.elements)) {
    if (!model.index.has(id)) model.index.set(id, element);
  }
  // Needs the finished index: an endpoint may be written before the element it
  // names, and `ID.side` is only a side when `ID.side` is not itself an element.
  resolveAttachSides(endpointSplits, model, diagnostics);

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

function applyStyleEntry(entry: {
  key: Token;
  styleTargetKind: string | undefined;
  values: Token[];
  target: DiagramStyle | null;
  inline: StyleProps | null;
  diagnostics: Diagnostic[];
}) {
  const { key, styleTargetKind, values, target, inline, diagnostics } = entry;
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
  // `keyText` is user source, so a bare index would resolve `constructor`,
  // `toString` and friends off `Object.prototype`: the entry reads as truthy,
  // every field is `undefined`, and the writer gets `expected: undefined`
  // instead of the `unknown style property` diagnostic below.
  const uniform = Object.hasOwn(UNIFORM_STYLE_ENTRIES, keyText)
    ? UNIFORM_STYLE_ENTRIES[keyText]
    : undefined;
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
