/**
 * Token grouping utility for the styleguide editor.
 *
 * Groups tokens by their dot-separated name prefix (e.g., "brand.primary" -> group "brand")
 * and provides token counting by type. Used by the middle pane of the three-pane token editor.
 */
import type { Token, TokenType } from "../../types/document";

export interface TokenGroup {
  readonly label: string;
  readonly tokenNames: readonly string[];
}

/**
 * Group tokens by their first dot-separated name segment.
 *
 * - Filters by `typeFilter` (pass `""` to include all types).
 * - Optionally filters by `searchQuery` (case-insensitive substring match on token name).
 * - Tokens without a dot separator are placed in the "ungrouped" group.
 * - Groups are sorted alphabetically, with "ungrouped" last.
 * - Token names within each group are sorted alphabetically.
 */
export function groupTokensByHierarchy(
  tokens: Record<string, Token>,
  typeFilter: TokenType | "",
  searchQuery: string = "",
): readonly TokenGroup[] {
  const groups = new Map<string, string[]>();
  const query = searchQuery.toLowerCase();

  for (const name of Object.keys(tokens)) {
    const token = tokens[name];
    if (!token) continue;
    if (typeFilter !== "" && token.token_type !== typeFilter) continue;
    if (query.length > 0 && !name.toLowerCase().includes(query)) continue;

    const dotIndex = name.indexOf(".");
    const groupLabel = dotIndex > 0 ? name.substring(0, dotIndex) : "ungrouped";

    let group = groups.get(groupLabel);
    if (!group) {
      group = [];
      groups.set(groupLabel, group);
    }
    group.push(name);
  }

  const sortedLabels = [...groups.keys()].sort((a, b) => {
    if (a === "ungrouped") return 1;
    if (b === "ungrouped") return -1;
    return a.localeCompare(b);
  });

  return sortedLabels.map((label) => {
    const names = groups.get(label);
    return {
      label,
      tokenNames: names ? names.sort() : [],
    };
  });
}

/**
 * Extract the short name from a dotted token name.
 * e.g. "brand.primary" -> "primary", "red" -> "red"
 */
export function shortName(fullName: string): string {
  const lastDot = fullName.lastIndexOf(".");
  return lastDot >= 0 ? fullName.substring(lastDot + 1) : fullName;
}

/**
 * Count tokens grouped by their `token_type`.
 * Returns a Map from TokenType to count.
 */
export function countTokensByType(tokens: Record<string, Token>): Map<TokenType, number> {
  const counts = new Map<TokenType, number>();
  for (const name of Object.keys(tokens)) {
    const token = tokens[name];
    if (!token) continue;
    counts.set(token.token_type, (counts.get(token.token_type) ?? 0) + 1);
  }
  return counts;
}
