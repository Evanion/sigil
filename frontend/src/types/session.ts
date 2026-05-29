/**
 * TypeScript mirror of the shared `SessionInfo` wire-format type
 * (Rust: `sigil_state::sessions::SessionInfo`, GraphQL: `SessionInfo`).
 *
 * Spec 20 §10 Cross-Stack Type Extension Inventory commits to this file
 * existing as the canonical TypeScript representation so future consumers
 * (welcome window, session switcher UI, etc.) import from one place.
 *
 * The wire format is GraphQL camelCase (`workfilePath`, `openedAt`) — both
 * the GraphQL resolver in `crates/server/src/graphql/session.rs` and the
 * Tauri shell's GraphQL client serialize this shape. The frontend consumes
 * it as-is via the urql cache.
 */

/**
 * Lifecycle state of a session. Mirrors `sigil_state::sessions::SessionState`.
 *
 * The GraphQL schema serializes these as SCREAMING_SNAKE_CASE (`LIVE`,
 * `ERRORED`); GraphQL queries that return SessionInfo will use those strings.
 * The Rust enum and the TypeScript type happen to capitalize differently,
 * which is why both are documented here.
 */
export type SessionState = "Live" | "Errored";

/**
 * GraphQL-level rendering of the same enum. Use this alias when receiving
 * values directly from an async-graphql resolver (which serializes the
 * variants in upper case).
 */
export type GqlSessionState = "LIVE" | "ERRORED";

/**
 * Lightweight session descriptor. Returned by:
 * - GraphQL `Query.sessions: [SessionInfo!]!`
 * - GraphQL `Mutation.openSession(path: String!): SessionInfo!`
 * - MCP tool `list_open_sessions` (which embeds the same shape inside its
 *   `sessions` payload, though MCP serializes via `serde_json::to_string`
 *   so the field names match this type's camelCase).
 */
export interface SessionInfo {
  /** Opaque UUIDv4 identifying the session. */
  id: string;
  /** Absolute canonical path to the workfile directory (the `.sigil/` bundle). */
  workfilePath: string;
  /** Display title derived from the workfile filename (stem without extension). */
  title: string;
  /** Open-time stamp; spec defers the exact format to a follow-up — treat as opaque for display. */
  openedAt: string;
  /** Lifecycle state. */
  state: SessionState | GqlSessionState;
}

/**
 * Type-level exhaustiveness sentinel for `SessionState`. If a new variant is
 * added to the Rust enum and mirrored here, the compiler will reject any
 * dispatch site that hasn't been updated, per frontend-defensive.md
 * §"Discriminated Unions Must Have a Type-Level Exhaustiveness Sentinel".
 */
export function assertSessionStateExhaustive(state: SessionState): void {
  switch (state) {
    case "Live":
    case "Errored":
      return;
    default: {
      const _exhaustive: never = state;
      throw new Error(`unhandled SessionState: ${String(_exhaustive)}`);
    }
  }
}
