// Recursive-descent parser for DSL v0.1.
// file    := nl* header stmt*
// header  := 'diagram' ID STRING?
// stmt    := styleBlock | element | flow
// element := ID(kind) ID(id) STRING? ('{' stmt* '}')?
// flow    := ID '->' ID (':' STRING)? ('{' styleEntry* '}')?
// styleBlock := 'style' '{' styleEntry* '}'
// styleEntry := ID (ID)? ':' value+ NL   (values: color | num | str | id)

import { lex, type Tok } from './lex.ts';
import type { Model, Element, Flow, Diagnostic, StyleProps, DiagramStyle, Span } from './model.ts';
import { defaultDiagramStyle } from './model.ts';

export function parse(src: string): { model: Model; diags: Diagnostic[] } {
  const diags: Diagnostic[] = [];
  const toks = lex(src, diags);
  let p = 0;

  const peek = (k = 0): Tok => toks[Math.min(p + k, toks.length - 1)];
  const at = (kind: string, text?: string) => peek().kind === kind && (text === undefined || peek().text === text);
  const next = (): Tok => toks[p < toks.length - 1 ? p++ : p];
  const skipNl = () => { while (at('nl')) next(); };
  const err = (message: string, span: Span, help?: string) =>
    diags.push({ code: 'E0101', severity: 'error', message, span, help });
  const syncLine = () => { while (!at('nl') && !at('eof')) next(); };

  const model: Model = {
    elements: [], flows: [], businessObjects: [], legendNotes: [],
    style: defaultDiagramStyle(), index: new Map(),
  };
  let flowSeq = 0;

  // ---- header ----
  skipNl();
  if (at('id', 'diagram')) {
    next();
    if (at('id')) { const t = next(); model.type = t.text; model.typeSpan = t.span; }
    else err('diagram type expected after `diagram`', peek().span, 'e.g. `diagram logical "Title"`');
    if (at('str')) model.title = next().text;
  } else {
    err('missing `diagram <type>` header on the first line', peek().span,
      'add `diagram logical "Title"` or scaffold a file with `cairn new --logical-architecture`');
  }

  // ---- statements ----
  function parseStyleEntries(target: DiagramStyle | null, inline: StyleProps | null) {
    // inside '{' ... '}'
    skipNl();
    while (!at('rbrace') && !at('eof')) {
      if (!at('id')) { err('style property expected', peek().span); syncLine(); skipNl(); continue; }
      const key = next();
      let kindTarget: string | undefined;
      if (at('id')) kindTarget = next().text; // e.g. `fill actor-group:`
      if (!at('colon')) { err('`:` expected after the style property', peek().span); syncLine(); skipNl(); continue; }
      next();
      const values: Tok[] = [];
      // read values up to end-of-line/block, but stop before the next `key:` so
      // several properties can share one line: `{ fill: #a  stroke: #b }`.
      while (!at('nl') && !at('rbrace') && !at('eof')) {
        if (values.length && at('id') && peek(1).kind === 'colon') break;
        values.push(next());
      }
      applyStyleEntry(key, kindTarget, values, target, inline, diags);
      skipNl();
    }
    if (at('rbrace')) next(); else err('`}` expected to close the style block', peek().span);
  }

  function parseElementBody(parent: Element) {
    skipNl();
    while (!at('rbrace') && !at('eof')) {
      parseStmt(parent);
      skipNl();
    }
    if (at('rbrace')) next(); else err('`}` expected to close `' + parent.id + '`', peek().span);
  }

  function parseStmt(parent: Element | null) {
    if (at('nl')) { next(); return; }
    if (at('id', 'style')) {
      const save = p; next();
      if (at('lbrace')) {
        next();
        if (parent) { parent.style = parent.style ?? {}; parseStyleEntries(null, parent.style); }
        else parseStyleEntries(model.style, null);
        return;
      }
      p = save; // `style` used as an ID — fall through
    }
    if (!parent && at('id', 'legend')) {
      const save = p; next();
      if (at('lbrace')) {
        next(); skipNl();
        while (!at('rbrace') && !at('eof')) {
          if (at('id', 'note')) {
            next();
            if (at('str')) model.legendNotes.push(next().text);
            else err('text expected after `note`', peek().span, 'e.g. `note "Named-data flows are subject to GDPR"`');
          } else { err('legend entries are `note "…"` lines', peek().span); syncLine(); }
          skipNl();
        }
        if (at('rbrace')) next(); else err('`}` expected to close the legend block', peek().span);
        return;
      }
      p = save;
    }
    if (!parent && at('id', 'business-object')) {
      next();
      if (!at('id')) { err('identifier expected after `business-object`', peek().span, 'e.g. `business-object BO_CMD "Commande" "description"`'); syncLine(); return; }
      const idTok = next();
      let name = idTok.text, description: string | undefined;
      if (at('str')) name = next().text;
      if (at('str')) description = next().text;
      model.businessObjects.push({ id: idTok.text, idSpan: idTok.span, name, description });
      return;
    }
    if (!at('id')) { err('declaration expected (element, flow or `style`)', peek().span); syncLine(); return; }

    const first = next();
    // flow?
    if (at('arrow')) {
      next();
      if (!at('id')) { err('target identifier expected after `->`', peek().span); syncLine(); return; }
      const to = next();
      const flow: Flow = {
        id: 'F' + String(++flowSeq).padStart(2, '0'),
        from: first.text, fromSpan: first.span,
        to: to.text, toSpan: to.span,
        span: { line: first.span.line, col: first.span.col, len: (to.span.col + to.span.len) - first.span.col },
      };
      if (at('colon')) {
        next();
        if (at('str')) flow.label = next().text;
        else err('flow label expected after `:`', peek().span, 'e.g. `A -> B : "Quote request"`');
      }
      if (at('lparen')) { // technical tail: (PROTOCOL, FORMAT)
        const open = next();
        const vals: string[] = [];
        while ((at('id') || at('num') || at('str')) && vals.length < 2) {
          vals.push(next().text);
          if (at('comma')) next();
        }
        if (at('rparen')) next();
        else err('`)` expected to close the technical attributes', peek().span, 'e.g. `A -> B : "Envoi" (SFTP, XML)`');
        flow.tech = { protocol: vals[0], format: vals[1], span: open.span };
      }
      if (at('lbrack')) { // business objects carried: [BO_A, BO_B]
        next();
        flow.objects = [];
        while (at('id')) {
          const t = next();
          flow.objects.push({ id: t.text, span: t.span });
          if (at('comma')) next();
        }
        if (at('rbrack')) next();
        else err('`]` expected to close the business-object list', peek().span, 'e.g. `A -> B : "Validation" [BO_CMD]`');
      }
      if (at('lbrace')) { next(); flow.style = {}; parseStyleEntries(null, flow.style); }
      model.flows.push(flow);
      return;
    }
    // element: kind id "label"? body?
    if (!at('id')) {
      err(`invalid declaration: \`${first.text}\` alone on this line`, first.span,
        'an element reads `<kind> <ID> "Label"`, a flow `<ID> -> <ID> : "label"`');
      syncLine(); return;
    }
    const idTok = next();
    const el: Element = {
      kind: first.text, kindSpan: first.span,
      id: idTok.text, idSpan: idTok.span,
      children: [], parent: parent ?? undefined,
    };
    if (at('str')) el.label = next().text;
    if (at('lparen')) { // optional attribute, e.g. trust-zone sensitivity: `(public)`
      next();
      if (at('id')) { const t = next(); el.attr = { value: t.text, span: t.span }; }
      else err('attribute value expected after `(`', peek().span, 'e.g. `trust-zone DMZ "DMZ" (public)`');
      if (at('rparen')) next();
      else err('`)` expected to close the attribute', peek().span, 'e.g. `trust-zone DMZ "DMZ" (public)`');
    }
    if (at('lbrace')) { next(); parseElementBody(el); }
    (parent ? parent.children : model.elements).push(el);
  }

  skipNl();
  while (!at('eof')) { parseStmt(null); skipNl(); }

  // flat index
  (function indexAll(els: Element[]) {
    for (const e of els) { model.index.set(e.id, model.index.has(e.id) ? model.index.get(e.id)! : e); indexAll(e.children); }
  })(model.elements);

  return { model, diags };
}

// ---- style entry semantics (terse shorthand, values disambiguated by shape) ----
const LINE_STYLES = new Set(['solid', 'dashed', 'dotted']);
const LABEL_POS = new Set(['on-line', 'above', 'below']);

function applyStyleEntry(
  key: Tok, kindTarget: string | undefined, values: Tok[],
  diag: DiagramStyle | null, inline: StyleProps | null, diags: Diagnostic[],
) {
  const strokeFrom = (vals: Tok[], span: Span): StyleProps['stroke'] => {
    const s: NonNullable<StyleProps['stroke']> = {};
    for (const v of vals) {
      if (v.kind === 'color') { if (s.color) dup(v); s.color = v.text; }
      else if (v.kind === 'num') { if (s.width) dup(v); s.width = parseFloat(v.text); }
      else if (v.kind === 'id' && LINE_STYLES.has(v.text)) { if (s.style) dup(v); s.style = v.text as any; }
      else bad(v, '`#hex` color, `solid|dashed|dotted` line style, or numeric width');
    }
    return s;
  };
  const dup = (v: Tok) => diags.push({ code: 'E0102', severity: 'error', message: `conflicting values in \`${key.text}\` : \`${v.text}\``, span: v.span, help: 'only one value of each type per property' });
  const bad = (v: Tok, expected: string) => diags.push({ code: 'E0103', severity: 'error', message: `invalid value \`${v.text}\` for \`${key.text}\``, span: v.span, help: `expected: ${expected}` });
  const one = () => values[0];

  const k = key.text;
  if (inline) {
    if (k === 'fill' && one()?.kind === 'color') inline.fill = one().text;
    else if (k === 'stroke') inline.stroke = strokeFrom(values, key.span);
    else if (k === 'text' && one()?.kind === 'color') inline.text = one().text;
    else if (k === 'label' && one()?.kind === 'id' && LABEL_POS.has(one().text)) inline.label = one().text as any;
    else diags.push({ code: 'E0104', severity: 'error', message: `unknown style property here: \`${k}\``, span: key.span, help: 'inline properties: fill, stroke, text, label' });
    return;
  }
  if (!diag) return;
  switch (k) {
    case 'crossing-hops': {
      const v = one();
      if (v?.kind === 'id' && (v.text === 'on' || v.text === 'off')) diag.crossingHops = v.text === 'on';
      else bad(v ?? key, '`on` or `off`');
      break;
    }
    case 'compact': {
      const v = one();
      if (v?.kind === 'id' && (v.text === 'on' || v.text === 'off')) diag.compact = v.text === 'on';
      else bad(v ?? key, '`on` or `off`');
      break;
    }
    case 'disposition': {
      const v = one();
      const OK = new Set(['wide', 'tall', 'slide', 'page']);
      if (v?.kind === 'id' && OK.has(v.text)) diag.disposition = v.text as any;
      else bad(v ?? key, '`wide` (elongated horizontal), `tall` (elongated vertical), `slide` (balanced 16:9), `page` (balanced A4 portrait)');
      break;
    }
    case 'legend': {
      const v = one();
      if (v?.kind === 'id' && (v.text === 'auto' || v.text === 'off')) diag.legend = v.text as any;
      else bad(v ?? key, '`auto` or `off`');
      break;
    }
    case 'flow-text': {
      const v = one();
      if (v?.kind === 'id' && (v.text === 'full' || v.text === 'numbered')) diag.flowText = v.text as any;
      else bad(v ?? key, '`full` (labels on arrows) or `numbered` (number badges + FLUX table below the diagram)');
      break;
    }
    case 'flow-label': {
      const v = one();
      if (v?.kind === 'id' && LABEL_POS.has(v.text)) diag.flowLabel = v.text as any;
      else bad(v ?? key, '`on-line`, `above` or `below`');
      break;
    }
    case 'flow-stroke': {
      const s = strokeFrom(values, key.span);
      diag.flowStroke = { ...diag.flowStroke, ...s };
      if (s.color) diag.flowStrokeColorSet = true;
      break;
    }
    case 'theme': {
      const v = one();
      if (v?.kind === 'id' && (v.text === 'light' || v.text === 'dark')) diag.theme = v.text as any;
      else bad(v ?? key, '`light` or `dark`');
      break;
    }
    case 'lang': {
      const v = one();
      if (v?.kind === 'id' && (v.text === 'en' || v.text === 'fr')) diag.lang = v.text as any;
      else bad(v ?? key, '`en` or `fr` (localizes rendered labels; keywords stay English)');
      break;
    }
    case 'background': {
      const v = one();
      if (v?.kind === 'color') diag.background = v.text;
      else bad(v ?? key, '`#hex` color (canvas background)');
      break;
    }
    case 'fill': {
      if (kindTarget && one()?.kind === 'color') {
        diag.kind[kindTarget] = { ...diag.kind[kindTarget], fill: one().text };
      } else bad(one() ?? key, '`fill <kind>: #hex`');
      break;
    }
    case 'stroke': {
      if (kindTarget) diag.kind[kindTarget] = { ...diag.kind[kindTarget], stroke: strokeFrom(values, key.span) };
      else bad(one() ?? key, '`stroke <kind>: #hex solid|dashed|dotted <width>`');
      break;
    }
    case 'text': {
      if (kindTarget && one()?.kind === 'color') {
        diag.kind[kindTarget] = { ...diag.kind[kindTarget], text: one().text };
      } else bad(one() ?? key, '`text <kind>: #hex`');
      break;
    }
    case 'font': {
      for (const v of values) {
        if (v.kind === 'str') diag.font.family = v.text;
        else if (v.kind === 'num') diag.font.size = parseFloat(v.text);
        else bad(v, '`font: "Family" <size>`');
      }
      break;
    }
    case 'font-size': {
      const v = one();
      if (v?.kind === 'num') diag.font.size = parseFloat(v.text);
      else bad(v ?? key, 'a number, e.g. `font-size: 14`');
      break;
    }
    default:
      diags.push({ code: 'E0104', severity: 'error', message: `unknown style property: \`${k}\``, span: key.span, help: 'properties: theme, lang, background, disposition, legend, flow-text, crossing-hops, compact, flow-label, flow-stroke, fill <kind>, stroke <kind>, text <kind>, font, font-size' });
  }
}
