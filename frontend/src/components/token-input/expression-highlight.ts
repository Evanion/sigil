/**
 * Expression highlighting tokenizer for the enhanced token input.
 *
 * Produces colored segments from an expression string for rendering
 * in the contentEditable input overlay. This is a display-only tokenizer,
 * NOT the full expression parser (see store/expression-eval.ts for that).
 */

// ── Segment types ──────────────────────────────────────────────────────

export interface HighlightSegment {
  readonly text: string;
  readonly type:
    | "tokenRef"
    | "function"
    | "number"
    | "operator"
    | "paren"
    | "text"
    | "error";
}

// ── Character classification helpers ───────────────────────────────────

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isIdentChar(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

function isOperator(ch: string): boolean {
  return ch === "+" || ch === "-" || ch === "*" || ch === "/";
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

// ── Tokenizer ──────────────────────────────────────────────────────────

/**
 * Tokenize an expression string into highlighted segments for display.
 *
 * Rules (character-by-character scan):
 * 1. `{...}` -- entire brace-enclosed content is one "tokenRef" segment (includes braces)
 * 2. Identifier followed by `(` -- identifier is "function", `(` is "paren"
 * 3. Digits with optional `.` and `%` -- "number"
 * 4. `+`, `-`, `*`, `/` -- "operator"
 * 5. `(`, `)`, `,` -- "paren"
 * 6. Whitespace -- "text"
 * 7. Unclosed `{` -- "error"
 * 8. Other unrecognized characters -- "text"
 */
export function highlightExpression(input: string): readonly HighlightSegment[] {
  if (input.length === 0) {
    return [];
  }

  const segments: HighlightSegment[] = [];
  let pos = 0;

  while (pos < input.length) {
    const ch = input[pos];

    // Rule 1 / 7: Token reference (brace-enclosed) or unclosed brace error
    if (ch === "{") {
      const closingIndex = input.indexOf("}", pos + 1);
      if (closingIndex === -1) {
        // Rule 7: unclosed brace -- rest of string is an error
        segments.push({ text: input.slice(pos), type: "error" });
        pos = input.length;
        continue;
      }
      // Rule 1: complete token reference
      segments.push({
        text: input.slice(pos, closingIndex + 1),
        type: "tokenRef",
      });
      pos = closingIndex + 1;
      continue;
    }

    // Rule 3: Number literal (digits with optional `.` and trailing `%`)
    if (isDigit(ch)) {
      const start = pos;
      while (pos < input.length && isDigit(input[pos])) {
        pos++;
      }
      // Optional decimal part
      if (pos < input.length && input[pos] === ".") {
        pos++;
        while (pos < input.length && isDigit(input[pos])) {
          pos++;
        }
      }
      // Optional percentage suffix
      if (pos < input.length && input[pos] === "%") {
        pos++;
      }
      segments.push({ text: input.slice(start, pos), type: "number" });
      continue;
    }

    // Rule 2 / identifiers: Could be a function name or plain text
    if (isIdentStart(ch)) {
      const start = pos;
      while (pos < input.length && isIdentChar(input[pos])) {
        pos++;
      }
      const ident = input.slice(start, pos);

      // Check if followed by `(` -- makes it a function
      if (pos < input.length && input[pos] === "(") {
        segments.push({ text: ident, type: "function" });
        // The `(` will be consumed in the next iteration as a paren
      } else {
        // Plain identifier text
        segments.push({ text: ident, type: "text" });
      }
      continue;
    }

    // Rule 4: Operators
    if (isOperator(ch)) {
      segments.push({ text: ch, type: "operator" });
      pos++;
      continue;
    }

    // Rule 5: Parentheses and comma
    if (ch === "(" || ch === ")" || ch === ",") {
      segments.push({ text: ch, type: "paren" });
      pos++;
      continue;
    }

    // Rule 6: Whitespace
    if (isWhitespace(ch)) {
      const start = pos;
      while (pos < input.length && isWhitespace(input[pos])) {
        pos++;
      }
      segments.push({ text: input.slice(start, pos), type: "text" });
      continue;
    }

    // Rule 8: Other unrecognized characters
    segments.push({ text: ch, type: "text" });
    pos++;
  }

  return segments;
}
