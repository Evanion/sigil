# Token Store + Resolution Implementation Plan (13a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reactive token store to the frontend, load tokens from GraphQL, resolve `StyleValue::TokenRef` to concrete values in the canvas renderer and property panels, and handle token mutation broadcasts from other clients.

**Architecture:** Tokens are loaded alongside pages/nodes from GraphQL into `DocumentState.tokens`. A `resolveToken(name)` function walks alias chains. All renderer fallback sites are updated to resolve via the token store. Token CRUD broadcasts are handled in `apply-remote.ts`. Store methods delegate to existing core FieldOperations via GraphQL.

**Tech Stack:** TypeScript/Solid.js (frontend store, resolution), GraphQL (token loading), Vitest (tests)

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `frontend/src/store/token-store.ts` | `resolveToken`, `resolveStyleValue` helpers + types |
| `frontend/src/store/__tests__/token-store.test.ts` | Token resolution tests |

### Major modifications
| File | Changes |
|------|---------|
| `frontend/src/store/document-store-solid.tsx` | Add `tokens` to DocumentState, token CRUD methods, load tokens from GraphQL |
| `frontend/src/store/document-store-types.ts` | Add TokenStoreAPI to DocumentStoreAPI |
| `frontend/src/graphql/queries.ts` | Add tokens to PAGES_QUERY |
| `frontend/src/canvas/renderer.ts` | Resolve TokenRef via token store at all fallback sites |
| `frontend/src/operations/apply-remote.ts` | Add create_token/update_token/delete_token handlers |
| `frontend/src/components/gradient-editor/gradient-utils.ts` | Update resolveStopColorCSS to accept token resolver |

---

## Task 1: Token resolution module

**Files:**
- Create: `frontend/src/store/token-store.ts`
- Create: `frontend/src/store/__tests__/token-store.test.ts`

- [ ] **Step 1: Create token-store.ts with resolveToken**

```typescript
import type { Token, TokenValue, Color, StyleValue } from "../types/document";

const MAX_ALIAS_DEPTH = 16;

export function resolveToken(
  tokens: Record<string, Token>,
  name: string,
): TokenValue | null {
  let current = name;
  for (let i = 0; i < MAX_ALIAS_DEPTH; i++) {
    const token = tokens[current];
    if (!token) return null;
    if (token.value.type === "alias") {
      current = token.value.name;
      continue;
    }
    return token.value;
  }
  return null;
}

export function resolveColorToken(
  tokens: Record<string, Token>,
  name: string,
): Color | null {
  const resolved = resolveToken(tokens, name);
  if (!resolved || resolved.type !== "color") return null;
  return resolved.value;
}

export function resolveNumberToken(
  tokens: Record<string, Token>,
  name: string,
): number | null {
  const resolved = resolveToken(tokens, name);
  if (!resolved) return null;
  if (resolved.type === "number") return resolved.value;
  if (resolved.type === "dimension") return resolved.value;
  if (resolved.type === "font_weight") return resolved.weight;
  return null;
}

export function resolveStyleValueColor(
  sv: StyleValue<Color>,
  tokens: Record<string, Token>,
  fallback: Color,
): Color {
  if (sv.type === "literal") return sv.value;
  return resolveColorToken(tokens, sv.name) ?? fallback;
}

export function resolveStyleValueNumber(
  sv: StyleValue<number>,
  tokens: Record<string, Token>,
  fallback: number,
): number {
  if (sv.type === "literal") return sv.value;
  return resolveNumberToken(tokens, sv.name) ?? fallback;
}
```

- [ ] **Step 2: Write tests**

Tests covering:
- `resolveToken`: direct value, alias chain (2 deep), missing token returns null, cycle detection (A→B→A returns null after MAX_ALIAS_DEPTH)
- `resolveColorToken`: returns Color for color tokens, null for non-color
- `resolveNumberToken`: returns number for number/dimension/font_weight tokens
- `resolveStyleValueColor`: literal passthrough, token_ref resolution, fallback on missing
- `resolveStyleValueNumber`: same pattern

- [ ] **Step 3: Run tests and commit**

```
feat(frontend): add token resolution module (Spec 13a, Task 1)
```

---

## Task 2: Add tokens to DocumentState + GraphQL loading

**Files:**
- Modify: `frontend/src/store/document-store-solid.tsx`
- Modify: `frontend/src/store/document-store-types.ts`
- Modify: `frontend/src/graphql/queries.ts`

- [ ] **Step 1: Add tokens field to DocumentState**

```typescript
export interface DocumentState {
  info: MutableDocumentInfo;
  pages: MutablePage[];
  nodes: Record<string, MutableDocumentNode>;
  tokens: Record<string, Token>;  // NEW
}
```

Initialize to `{}` in store creation.

- [ ] **Step 2: Add tokens to GraphQL query**

Check if the server exposes a `tokens` query. If yes, add it to `PAGES_QUERY`. If the server doesn't expose it yet, add a separate tokens query or fetch them via MCP list_tokens equivalent.

Actually — tokens are already queryable via the MCP `list_tokens` tool, and the GraphQL schema has `DocumentEventType::TokenCreated/Updated/Deleted`. But there may not be a GraphQL query for listing tokens. Check `crates/server/src/graphql/query.rs` for a tokens query.

If no GraphQL tokens query exists, add one to the server that returns all tokens from `doc.token_context`.

- [ ] **Step 3: Parse tokens in the store**

Add `parseTokensResponse` function that parses the GraphQL response into `Record<string, Token>`. Call it alongside `parsePagesResponse` in the initial data load.

- [ ] **Step 4: Add token store methods to DocumentStoreAPI**

```typescript
interface TokenStoreAPI {
  createToken(name: string, type: TokenType, value: TokenValue, description?: string): void;
  updateToken(name: string, value: TokenValue, description?: string): void;
  deleteToken(name: string): void;
}
```

Implement using optimistic updates + GraphQL applyOperations (same pattern as page mutations). The server already has AddToken/UpdateToken/RemoveToken FieldOperations — wire them through the existing operation pipeline.

Note: Check if GraphQL `OperationInput` has token variants. If not, add them to the server (`crates/server/src/graphql/types.rs` + `mutation.rs`) following the page operations pattern from PR #48.

- [ ] **Step 5: Expose resolveToken on the store API**

```typescript
resolveToken(name: string): TokenValue | null;
```

Uses the token resolution module from Task 1 with `state.tokens`.

- [ ] **Step 6: Update mock stores**

Add token methods to all mock store instances in test/story files.

- [ ] **Step 7: Run tests and commit**

```
feat(frontend): add token store with GraphQL loading and CRUD methods (Spec 13a, Task 2)
```

---

## Task 3: Canvas renderer — resolve TokenRef

**Files:**
- Modify: `frontend/src/canvas/renderer.ts`
- Modify: `frontend/src/components/gradient-editor/gradient-utils.ts`

- [ ] **Step 1: Pass token store to the renderer**

The `render()` function currently takes `nodes`, `selectedUuids`, etc. Add a `tokens: Record<string, Token>` parameter. The caller in `Canvas.tsx` passes `store.state.tokens`.

- [ ] **Step 2: Update all StyleValue fallback sites**

Replace every `TokenRef → fallback` pattern with token resolution:

1. **Solid fill color** — `resolveFillStyle`: resolve `fill.color` via `resolveStyleValueColor`
2. **Text color** — resolve `text_style.text_color` via token store
3. **Font size** — resolve `text_style.font_size` via `resolveStyleValueNumber`
4. **Line height** — resolve `text_style.line_height` via `resolveStyleValueNumber`
5. **Letter spacing** — resolve `text_style.letter_spacing` via `resolveStyleValueNumber`
6. **Gradient stop color** — update `resolveStopColorCSS` in gradient-utils to accept tokens
7. **Text shadow color** — resolve shadow color via token store
8. **Stroke color/width** — resolve in StrokeRow.tsx (panel display)
9. **Effect blur/spread/color** — resolve in EffectCard.tsx (panel display)

For the renderer, create a closure or pass tokens through:

```typescript
export function render(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  nodes: readonly DocumentNode[],
  selectedUuids: ReadonlySet<string>,
  tokens: Record<string, Token>,  // NEW
  dpr?: number,
  // ... other params
): void
```

- [ ] **Step 3: Update Canvas.tsx to pass tokens**

In the render effect, pass `store.state.tokens` to the renderer.

- [ ] **Step 4: Update gradient-utils resolveStopColorCSS**

Add optional `tokens` parameter:

```typescript
export function resolveStopColorCSS(
  color: StyleValue<Color>,
  tokens?: Record<string, Token>,
): string {
  if (color.type === "literal" && color.value.space === "srgb") {
    // ... existing sRGB path
  }
  if (color.type === "token_ref" && tokens) {
    const resolved = resolveColorToken(tokens, color.name);
    if (resolved && resolved.space === "srgb") {
      return srgbColorToRgba(resolved);
    }
  }
  return "rgba(0, 0, 0, 1)";
}
```

- [ ] **Step 5: Run tests and commit**

```
feat(frontend): resolve TokenRef values in canvas renderer (Spec 13a, Task 3)
```

---

## Task 4: apply-remote token handlers

**Files:**
- Modify: `frontend/src/operations/apply-remote.ts`

- [ ] **Step 1: Add token operation handlers**

```typescript
case "create_token":
  applyCreateToken(op.value, setState);
  break;
case "update_token":
  applyUpdateToken(op.nodeUuid, op.value, setState);
  break;
case "delete_token":
  applyDeleteToken(op.nodeUuid, setState);
  break;
```

Each handler updates `state.tokens` via `produce()`:

```typescript
function applyCreateToken(value: unknown, setState: SetStoreFunction<StoreState>): void {
  // Parse token from value payload
  // Add to state.tokens[name]
}

function applyUpdateToken(name: string, value: unknown, setState: SetStoreFunction<StoreState>): void {
  // Update state.tokens[name] with new value
}

function applyDeleteToken(name: string, setState: SetStoreFunction<StoreState>): void {
  // Remove state.tokens[name]
}
```

- [ ] **Step 2: Run tests and commit**

```
feat(frontend): add token operation handlers to apply-remote (Spec 13a, Task 4)
```

---

## Task 5: Server — add GraphQL token query + mutation variants

**Files:**
- Modify: `crates/server/src/graphql/query.rs` (or types.rs)
- Modify: `crates/server/src/graphql/types.rs`
- Modify: `crates/server/src/graphql/mutation.rs`

- [ ] **Step 1: Add tokens query**

Check if a `tokens` query exists in the GraphQL schema. If not, add one:

```rust
async fn tokens(&self, ctx: &Context<'_>) -> Result<Vec<TokenGql>> {
    let state = ctx.data::<ServerState>()?;
    let doc = acquire_document_lock(state);
    // Iterate doc.token_context and build response
}
```

- [ ] **Step 2: Add token mutation variants to OperationInput**

```rust
#[derive(InputObject)]
pub struct AddTokenInput {
    pub name: String,
    pub token_type: String,
    pub value: String, // JSON-serialized TokenValue
    pub description: Option<String>,
}

// Similar for UpdateToken, RemoveToken
```

Add to `OperationInput` enum and implement `parse_add_token`, `parse_update_token`, `parse_remove_token`.

- [ ] **Step 3: Run Rust tests and commit**

```
feat(server): add GraphQL token query and mutation variants (Spec 13a, Task 5)
```

---

## Task 6: Integration tests + verification

- [ ] **Step 1: Token store resolution tests**

Verify the full path: token in store → field bound as TokenRef → renderer resolves to correct value.

- [ ] **Step 2: Run full test suites**

```bash
cargo test --workspace
pnpm --prefix frontend test
pnpm --prefix frontend build
```

- [ ] **Step 3: Commit**

```
test: integration verification for token store (Spec 13a, Task 6)
```

---

## Dependency Graph

```
Task 1 (resolution module) → Task 3 (renderer resolution)
Task 2 (store + GraphQL loading) → Task 3
Task 5 (server query + mutations) → Task 2
Task 2 → Task 4 (apply-remote)
All → Task 6 (integration)
```

Task 1 and Task 5 are independent starting points. Task 2 depends on Task 5 (server must expose tokens before frontend can load them).
