// Hand-rolled lexer. Newlines are tokens (style entries are line-terminated).
// `#` starts a comment UNLESS immediately followed by 3-8 hex digits and a
// word boundary, in which case it is a COLOR literal (documented heuristic).

import type { Span, Diagnostic } from './model.ts';

export type TokKind = 'id' | 'str' | 'num' | 'color' | 'arrow' | 'colon' | 'lbrace' | 'rbrace' | 'lbrack' | 'rbrack' | 'lparen' | 'rparen' | 'comma' | 'nl' | 'eof';
export interface Tok { kind: TokKind; text: string; span: Span; }

const HEX = /^[0-9a-fA-F]{3,8}$/;
const isIdChar = (c: string) => /[A-Za-z0-9_\-/.]/.test(c); // '/' and '.' allowed for protocols like TCP/443, v1.2

export function lex(src: string, diags: Diagnostic[]): Tok[] {
  const toks: Tok[] = [];
  let i = 0, line = 1, col = 1;
  const push = (kind: TokKind, text: string, l: number, c: number) =>
    toks.push({ kind, text, span: { line: l, col: c, len: Math.max(text.length, 1) } });

  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { push('nl', '\n', line, col); i++; line++; col = 1; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; col++; continue; }

    if (c === '#') {
      // color or comment?
      let j = i + 1;
      while (j < src.length && isIdChar(src[j])) j++;
      const word = src.slice(i + 1, j);
      if (HEX.test(word)) {
        push('color', '#' + word, line, col);
        col += word.length + 1; i = j; continue;
      }
      while (i < src.length && src[i] !== '\n') { i++; col++; } // comment to EOL
      continue;
    }
    if (c === '"') {
      const l = line, cl = col;
      let out = '', j = i + 1; col++;
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\' && src[j + 1] === 'n') { out += '\n'; j += 2; col += 2; }
        else if (src[j] === '\\' && src[j + 1] === '"') { out += '"'; j += 2; col += 2; }
        else if (src[j] === '\n') { break; }
        else { out += src[j]; j++; col++; }
      }
      if (src[j] !== '"') {
        diags.push({ code: 'E0101', severity: 'error', message: 'unterminated string', span: { line: l, col: cl, len: j - i }, help: 'add the closing `"` quote' });
      }
      push('str', out, l, cl);
      toks[toks.length - 1].span.len = j - i + 1;
      i = j + 1; col++; continue;
    }
    if (c === '-' && src[i + 1] === '>') { push('arrow', '->', line, col); i += 2; col += 2; continue; }
    if (c === ':') { push('colon', ':', line, col); i++; col++; continue; }
    if (c === '{') { push('lbrace', '{', line, col); i++; col++; continue; }
    if (c === '}') { push('rbrace', '}', line, col); i++; col++; continue; }
    if (c === '[') { push('lbrack', '[', line, col); i++; col++; continue; }
    if (c === ']') { push('rbrack', ']', line, col); i++; col++; continue; }
    if (c === '(') { push('lparen', '(', line, col); i++; col++; continue; }
    if (c === ')') { push('rparen', ')', line, col); i++; col++; continue; }
    if (c === ',') { push('comma', ',', line, col); i++; col++; continue; }

    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++;
      push('num', src.slice(i, j), line, col); col += j - i; i = j; continue;
    }
    if (isIdChar(c)) {
      let j = i; while (j < src.length && isIdChar(src[j])) j++;
      push('id', src.slice(i, j), line, col); col += j - i; i = j; continue;
    }
    diags.push({ code: 'E0101', severity: 'error', message: `unexpected character \`${c}\``, span: { line, col, len: 1 } });
    i++; col++;
  }
  push('eof', '', line, col);
  return toks;
}
