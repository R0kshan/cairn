import type { Span, Diagnostic } from "./model.ts";

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

const HEX_PATTERN = /^[0-9a-fA-F]{3,8}$/;
const isIdChar = (char: string) => /[A-Za-z0-9_\-/.]/.test(char);

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
    if (char === "-" && src[position + 1] === ">") {
      push("arrow", "->", line, col);
      position += 2;
      col += 2;
      continue;
    }
    if (char === ":") {
      push("colon", ":", line, col);
      position++;
      col++;
      continue;
    }
    if (char === "{") {
      push("lbrace", "{", line, col);
      position++;
      col++;
      continue;
    }
    if (char === "}") {
      push("rbrace", "}", line, col);
      position++;
      col++;
      continue;
    }
    if (char === "[") {
      push("lbrack", "[", line, col);
      position++;
      col++;
      continue;
    }
    if (char === "]") {
      push("rbrack", "]", line, col);
      position++;
      col++;
      continue;
    }
    if (char === "(") {
      push("lparen", "(", line, col);
      position++;
      col++;
      continue;
    }
    if (char === ")") {
      push("rparen", ")", line, col);
      position++;
      col++;
      continue;
    }
    if (char === ",") {
      push("comma", ",", line, col);
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
