/**
 * Stage 1 of the pipeline: turns raw `.cairn` source into a flat `Token[]`.
 * Hand-written single-pass scanner tracking line/col for precise spans. Handles
 * `#`-comments vs `#hex` colors, quoted strings with `\n`/`\"` escapes, `->`,
 * punctuation, numbers and identifiers. Lexical errors are pushed as `E0101`
 * diagnostics rather than thrown, so scanning always completes.
 */

import type { Diagnostic } from "./models/diagnostic.ts";
import type { Token, TokenKind } from "./models/token.ts";

const HEX_PATTERN = /^[0-9a-fA-F]{3,8}$/;
const isIdChar = (char: string) => /[A-Za-z0-9_\-/.]/.test(char);

/** Single-character punctuation tokens, keyed by the character that produces them. */
const SINGLE_CHAR_TOKENS: Record<string, TokenKind> = {
  ":": "colon",
  "{": "lbrace",
  "}": "rbrace",
  "[": "lbrack",
  "]": "rbrack",
  "(": "lparen",
  ")": "rparen",
  ",": "comma",
};

/** Lexes source text into a token stream and reports any lexical errors as diagnostics. */
export function lex(src: string, diagnostics: Diagnostic[]): Token[] {
  const tokens: Token[] = [];
  let position = 0,
    line = 1,
    col = 1;
  const push = (kind: TokenKind, text: string, lineNumber: number, colNumber: number) =>
    tokens.push({
      kind,
      text,
      span: {
        line: lineNumber,
        col: colNumber,
        len: Math.max(text.length, 1),
      },
    });

  while (position < src.length) {
    const char = src[position];
    if (char === "\n") {
      push("nl", "\n", line, col);
      position++;
      line++;
      col = 1;
      continue;
    }
    if (char === " " || char === "\t" || char === "\r") {
      position++;
      col++;
      continue;
    }

    if (char === "#") {
      let scanIndex = position + 1;
      while (scanIndex < src.length && isIdChar(src[scanIndex])) scanIndex++;
      const word = src.slice(position + 1, scanIndex);
      if (HEX_PATTERN.test(word)) {
        push("color", "#" + word, line, col);
        col += word.length + 1;
        position = scanIndex;
        continue;
      }
      while (position < src.length && src[position] !== "\n") {
        position++;
        col++;
      }
      continue;
    }
    if (char === '"') {
      const startLine = line,
        startCol = col;
      let unescaped = "",
        scanIndex = position + 1;
      col++;
      while (scanIndex < src.length && src[scanIndex] !== '"') {
        if (src[scanIndex] === "\\" && src[scanIndex + 1] === "n") {
          unescaped += "\n";
          scanIndex += 2;
          col += 2;
        } else if (src[scanIndex] === "\\" && src[scanIndex + 1] === '"') {
          unescaped += '"';
          scanIndex += 2;
          col += 2;
        } else if (src[scanIndex] === "\n") {
          break;
        } else {
          unescaped += src[scanIndex];
          scanIndex++;
          col++;
        }
      }
      if (src[scanIndex] !== '"') {
        diagnostics.push({
          code: "E0101",
          severity: "error",
          message: "unterminated string",
          span: {
            line: startLine,
            col: startCol,
            len: scanIndex - position,
          },
          help: 'add the closing `"` quote',
        });
      }
      push("str", unescaped, startLine, startCol);
      tokens[tokens.length - 1].span.len = scanIndex - position + 1;
      position = scanIndex + 1;
      col++;
      continue;
    }
    // The three arrow glyphs, longest first: `-` and `.` are both id characters,
    // so these branches must run before the id scan or `-->` lexes as the id
    // `--`. The glyph carries the flow's line style (`->` solid, `-->` dashed,
    // `..>` dotted); like `->`, each needs whitespace before it.
    const arrowGlyph = ["-->", "..>", "->"].find(
      (glyph) => src.startsWith(glyph, position) && glyph[0] === char,
    );
    if (arrowGlyph) {
      push("arrow", arrowGlyph, line, col);
      position += arrowGlyph.length;
      col += arrowGlyph.length;
      continue;
    }
    const singleCharKind = SINGLE_CHAR_TOKENS[char];
    if (singleCharKind) {
      push(singleCharKind, char, line, col);
      position++;
      col++;
      continue;
    }

    if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(src[position + 1] ?? ""))) {
      let scanIndex = position;
      while (scanIndex < src.length && /[0-9.]/.test(src[scanIndex])) scanIndex++;
      push("num", src.slice(position, scanIndex), line, col);
      col += scanIndex - position;
      position = scanIndex;
      continue;
    }
    if (isIdChar(char)) {
      let scanIndex = position;
      while (scanIndex < src.length && isIdChar(src[scanIndex])) scanIndex++;
      push("id", src.slice(position, scanIndex), line, col);
      col += scanIndex - position;
      position = scanIndex;
      continue;
    }
    diagnostics.push({
      code: "E0101",
      severity: "error",
      message: `unexpected character \`${char}\``,
      span: { line, col, len: 1 },
    });
    position++;
    col++;
  }
  push("eof", "", line, col);
  return tokens;
}
