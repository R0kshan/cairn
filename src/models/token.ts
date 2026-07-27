/**
 * Lexical token vocabulary: the `TokenKind` union and the `Token` record
 * (kind, text, span) that the lexer produces and the parser consumes. Canonical
 * home for these types — the lexer and parser both import from here.
 */

import type { Span } from "./ast.ts";

export type TokenKind =
  | "id"
  | "str"
  | "num"
  | "color"
  | "arrow"
  | "colon"
  | "lbrace"
  | "rbrace"
  | "lbrack"
  | "rbrack"
  | "lparen"
  | "rparen"
  | "comma"
  | "nl"
  | "eof";

export interface Token {
  kind: TokenKind;
  text: string;
  span: Span;
}
