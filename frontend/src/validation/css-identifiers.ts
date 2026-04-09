/**
 * CSS identifier validation helpers.
 *
 * Mirrors the validation in crates/core/src/validate.rs
 * `FONT_FAMILY_FORBIDDEN_CHARS` and related checks.
 *
 * Per CLAUDE.md "Validation Must Be Symmetric Across All Transports":
 * the same validation that the Rust core applies must also be enforced
 * at the frontend boundary before sending values to the server.
 */

/**
 * Characters forbidden in font family names.
 * Matches the Rust constant `FONT_FAMILY_FORBIDDEN_CHARS` in validate.rs.
 * CSS-significant or injection-prone characters.
 */
const FONT_FAMILY_FORBIDDEN_CHARS = ["'", '"', ";", "{", "}", "\\"];

/**
 * Validates that a string is safe to use as a CSS font-family value
 * or other CSS identifier rendered into a Canvas 2D context property.
 *
 * Rejects:
 * - Empty strings
 * - Strings containing CSS-significant characters (quotes, semicolons, braces, backslash)
 * - Strings containing C0 control characters (0x00-0x1F)
 *
 * @returns true if the value is safe, false otherwise.
 */
export function validateCssIdentifier(value: string): boolean {
  if (value.length === 0) return false;

  for (const ch of value) {
    // Reject C0 control characters (0x00-0x1F)
    if (ch.charCodeAt(0) <= 0x1f) return false;
    // Reject CSS-significant characters
    if (FONT_FAMILY_FORBIDDEN_CHARS.includes(ch)) return false;
  }

  return true;
}
