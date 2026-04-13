/**
 * Shared helpers for token panel components.
 *
 * Provides i18n label keys, default token values, and type grouping utilities.
 */

import type { TokenType, TokenValue } from "../types/document";

/** All concrete token types (excluding alias which is a reference). */
export const TOKEN_TYPES: readonly TokenType[] = [
  "color",
  "dimension",
  "number",
  "font_family",
  "font_weight",
  "duration",
  "cubic_bezier",
  "shadow",
  "gradient",
  "typography",
] as const;

/** Map from TokenType to i18n key in panels:tokens namespace. */
export const TOKEN_TYPE_I18N_KEYS: Record<TokenType, string> = {
  color: "panels:tokens.typeColor",
  dimension: "panels:tokens.typeDimension",
  number: "panels:tokens.typeNumber",
  font_family: "panels:tokens.typeFontFamily",
  font_weight: "panels:tokens.typeFontWeight",
  duration: "panels:tokens.typeDuration",
  cubic_bezier: "panels:tokens.typeCubicBezier",
  shadow: "panels:tokens.typeShadow",
  gradient: "panels:tokens.typeGradient",
  typography: "panels:tokens.typeTypography",
};

/** Create a default TokenValue for the given type. */
export function defaultTokenValue(tokenType: TokenType): TokenValue {
  switch (tokenType) {
    case "color":
      return { type: "color", value: { space: "srgb", r: 0, g: 0, b: 0, a: 1 } };
    case "dimension":
      return { type: "dimension", value: 16, unit: "px" };
    case "number":
      return { type: "number", value: 0 };
    case "font_family":
      return { type: "font_family", families: ["sans-serif"] };
    case "font_weight":
      return { type: "font_weight", weight: 400 };
    case "duration":
      return { type: "duration", seconds: 0.3 };
    case "cubic_bezier":
      return { type: "cubic_bezier", values: [0.25, 0.1, 0.25, 1] };
    case "shadow":
      return {
        type: "shadow",
        value: {
          color: { space: "srgb", r: 0, g: 0, b: 0, a: 0.25 },
          offset: { x: 0, y: 4 },
          blur: 8,
          spread: 0,
        },
      };
    case "gradient":
      return {
        type: "gradient",
        gradient: {
          stops: [
            {
              position: 0,
              color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 0, a: 1 } },
            },
            {
              position: 1,
              color: { type: "literal", value: { space: "srgb", r: 1, g: 1, b: 1, a: 1 } },
            },
          ],
          start: { x: 0, y: 0 },
          end: { x: 1, y: 0 },
        },
      };
    case "typography":
      return {
        type: "typography",
        value: {
          font_family: "sans-serif",
          font_size: 16,
          font_weight: 400,
          line_height: 1.5,
          letter_spacing: 0,
        },
      };
    default: {
      // Exhaustive check
      const _exhaustive: never = tokenType;
      void _exhaustive;
      return { type: "number", value: 0 };
    }
  }
}

/**
 * Group tokens by their token_type.
 * Returns an array of [TokenType, tokenNames[]] pairs, preserving TOKEN_TYPES order.
 */
export function groupTokensByType(
  tokens: Record<string, { token_type: TokenType }>,
): Array<[TokenType, string[]]> {
  const groups: Partial<Record<TokenType, string[]>> = {};

  for (const name of Object.keys(tokens)) {
    const token = tokens[name];
    if (!token) continue;
    const type = token.token_type;
    if (!groups[type]) {
      groups[type] = [];
    }
    const group = groups[type];
    if (group) {
      group.push(name);
    }
  }

  const result: Array<[TokenType, string[]]> = [];
  for (const type of TOKEN_TYPES) {
    const names = groups[type];
    if (names && names.length > 0) {
      result.push([type, names]);
    }
  }

  return result;
}
