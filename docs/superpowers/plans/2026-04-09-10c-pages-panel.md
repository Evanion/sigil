# Pages Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully functional pages panel with page list, thumbnails, CRUD operations, DnD reorder, inline rename, keyboard navigation, and accessibility — replacing the current placeholder.

**Architecture:** The pages panel reuses the existing DnD infrastructure (`dnd-kit-solid`) for sortable reorder. Page CRUD operations (create, delete, rename) already exist as core FieldOperations — they need GraphQL mutation wiring and frontend store methods. A new `ReorderPage` core command handles drag reorder. Thumbnails use an offscreen canvas with the existing `drawNode` renderer at a scaled viewport.

**Tech Stack:** Rust (core ReorderPage command, GraphQL mutations), TypeScript/Solid.js (PagesPanel component, store methods), dnd-kit-solid (DnD reorder), Canvas 2D (thumbnails), Vitest (tests)

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `frontend/src/panels/PagesPanel.tsx` | Full pages panel component (replaces placeholder) |
| `frontend/src/panels/PagesPanel.css` | Pages panel styles |
| `frontend/src/panels/PageListItem.tsx` | Single page row: thumbnail, name, controls |
| `frontend/src/panels/PageListItem.css` | Page item styles |
| `frontend/src/panels/page-thumbnail.ts` | Offscreen canvas thumbnail renderer |
| `frontend/src/panels/__tests__/PagesPanel.test.tsx` | Pages panel tests |

### Major modifications
| File | Changes |
|------|---------|
| `crates/core/src/commands/page_commands.rs` | Add `ReorderPage` FieldOperation |
| `crates/core/src/document.rs` | Add `reorder_page` helper method |
| `crates/server/src/graphql/mutation.rs` | Add page operation variants to `OperationInput` (CreatePage, DeletePage, RenamePage, ReorderPage) |
| `crates/server/src/graphql/types.rs` | Add page input types |
| `crates/mcp/src/tools/pages.rs` | Add `reorder_page_impl` |
| `crates/mcp/src/server.rs` | Register `reorder_page` tool |
| `frontend/src/store/document-store-solid.tsx` | Add `createPage`, `deletePage`, `renamePage`, `reorderPages`, `setActivePage` methods |
| `frontend/src/store/document-store-types.ts` | Add page methods to DocumentStoreAPI |
| `frontend/src/graphql/mutations.ts` | Add page mutation strings |
| `frontend/src/operations/apply-remote.ts` | Add page operation handlers |

---

## Task 1: Add ReorderPage core command

**Files:**
- Modify: `crates/core/src/commands/page_commands.rs`
- Modify: `crates/core/src/document.rs`

- [ ] **Step 1: Write failing test**

```rust
#[test]
fn test_reorder_page_validate_and_apply() {
    let mut doc = Document::new("Test".to_string());
    let page_a = PageId::new(uuid::Uuid::new_v4());
    let page_b = PageId::new(uuid::Uuid::new_v4());
    let page_c = PageId::new(uuid::Uuid::new_v4());
    doc.add_page(Page::new(page_a, "Page A".to_string())).unwrap();
    doc.add_page(Page::new(page_b, "Page B".to_string())).unwrap();
    doc.add_page(Page::new(page_c, "Page C".to_string())).unwrap();

    // Move page C (index 2) to index 0
    let op = ReorderPage { page_id: page_c, new_position: 0 };
    op.validate(&doc).unwrap();
    op.apply(&mut doc).unwrap();

    assert_eq!(doc.pages[0].id, page_c);
    assert_eq!(doc.pages[1].id, page_a);
    assert_eq!(doc.pages[2].id, page_b);
}
```

- [ ] **Step 2: Implement ReorderPage**

```rust
/// Moves a page to a new position in the document's page list.
#[derive(Debug)]
pub struct ReorderPage {
    pub page_id: PageId,
    pub new_position: usize,
}

impl FieldOperation for ReorderPage {
    fn validate(&self, doc: &Document) -> Result<(), CoreError> {
        // Check page exists
        doc.page(self.page_id)?;
        // Check position is valid
        if self.new_position >= doc.pages.len() {
            return Err(CoreError::ValidationError(format!(
                "new_position {} out of range (0..{})",
                self.new_position,
                doc.pages.len()
            )));
        }
        Ok(())
    }

    fn apply(&self, doc: &mut Document) -> Result<(), CoreError> {
        let old_pos = doc.pages.iter().position(|p| p.id == self.page_id)
            .ok_or_else(|| CoreError::ValidationError("page not found".into()))?;
        let page = doc.pages.remove(old_pos);
        doc.pages.insert(self.new_position, page);
        Ok(())
    }
}
```

- [ ] **Step 3: Add validation rejection tests**

Tests for: page not found, position out of range, same position (should succeed as no-op).

- [ ] **Step 4: Run tests and commit**

```
feat(core): add ReorderPage FieldOperation (Spec 10c, Task 1)
```

---

## Task 2: Wire page operations into GraphQL

**Files:**
- Modify: `crates/server/src/graphql/types.rs`
- Modify: `crates/server/src/graphql/mutation.rs`

Currently the GraphQL `applyOperations` only handles node operations. Page CRUD needs to go through it too.

- [ ] **Step 1: Add page input types to types.rs**

```rust
#[derive(InputObject)]
pub struct CreatePageInput {
    pub name: String,
}

#[derive(InputObject)]
pub struct DeletePageInput {
    pub page_id: String,
}

#[derive(InputObject)]
pub struct RenamePageInput {
    pub page_id: String,
    pub new_name: String,
}

#[derive(InputObject)]
pub struct ReorderPageInput {
    pub page_id: String,
    pub new_position: i32,
}
```

- [ ] **Step 2: Add page variants to OperationInput**

```rust
#[derive(OneofObject)]
pub enum OperationInput {
    // ... existing variants ...
    CreatePage(CreatePageInput),
    DeletePage(DeletePageInput),
    RenamePage(RenamePageInput),
    ReorderPage(ReorderPageInput),
}
```

- [ ] **Step 3: Implement parse functions for page operations**

In `mutation.rs`, add `parse_create_page`, `parse_delete_page`, `parse_rename_page`, `parse_reorder_page` functions following the existing `parse_create_node` pattern. Each constructs a `ParsedOp` with the appropriate `FieldOperation` and broadcast `OperationPayload`.

Update `parse_operation_input` to dispatch on the new variants.

- [ ] **Step 4: Add tests**

Test creating a page, renaming it, reordering, and deleting via `applyOperations`.

- [ ] **Step 5: Run tests and commit**

```
feat(server): wire page operations into GraphQL applyOperations (Spec 10c, Task 2)
```

---

## Task 3: Add MCP reorder_page tool

**Files:**
- Modify: `crates/mcp/src/tools/pages.rs`
- Modify: `crates/mcp/src/server.rs`
- Modify: `crates/mcp/src/types.rs`

- [ ] **Step 1: Add ReorderPageInput type**

```rust
#[derive(Debug, Serialize, Deserialize, schemars::JsonSchema)]
pub struct ReorderPageInput {
    pub page_id: String,
    pub new_position: u32,
}
```

- [ ] **Step 2: Implement reorder_page_impl**

Follow the exact pattern of `rename_page_impl`:
1. Parse UUID
2. Acquire lock
3. Construct `ReorderPage { page_id, new_position }`
4. validate + apply
5. Build response
6. Drop lock
7. broadcast_and_persist

- [ ] **Step 3: Register tool in server.rs**

```rust
#[tool(name = "reorder_page", description = "Move a page to a new position in the page list")]
fn reorder_page(...) { ... }
```

- [ ] **Step 4: Run tests and commit**

```
feat(mcp): add reorder_page tool (Spec 10c, Task 3)
```

---

## Task 4: Frontend store — page mutation methods

**Files:**
- Modify: `frontend/src/store/document-store-types.ts`
- Modify: `frontend/src/store/document-store-solid.tsx`
- Modify: `frontend/src/graphql/mutations.ts`

- [ ] **Step 1: Add GraphQL mutation strings**

```typescript
export const CREATE_PAGE_MUTATION = `
  mutation CreatePage($operations: [OperationInput!]!, $userId: String!) {
    applyOperations(operations: $operations, userId: $userId) { seq }
  }
`;
```

The same `APPLY_OPERATIONS_MUTATION` can be reused — just pass `createPage` variant in the operations array.

- [ ] **Step 2: Add page methods to DocumentStoreAPI**

```typescript
export interface DocumentStoreAPI {
  // ... existing ...
  createPage(name: string): void;
  deletePage(pageId: string): void;
  renamePage(pageId: string, newName: string): void;
  reorderPages(pageId: string, newPosition: number): void;
  setActivePage(pageId: string): void;
  activePageId(): string | null;
}
```

- [ ] **Step 3: Implement store methods**

Each method follows the optimistic update pattern:
1. Apply change to local store immediately
2. Send operation to server via `applyOperations`
3. On error: revert + show notification

For `createPage`: generate UUID, add to `state.pages`, send `createPage` operation.
For `deletePage`: guard against deleting last page, remove from `state.pages`, if deleting active page switch to first remaining.
For `renamePage`: update name in `state.pages`.
For `reorderPages`: splice page to new position in `state.pages`.
For `setActivePage`: update a signal/store field tracking the active page ID.

- [ ] **Step 4: Add `activePageId` signal to store**

Add an `activePageId` signal that defaults to the first page's ID. When pages are fetched, set it to the first page if not already set.

- [ ] **Step 5: Update mock stores in test files**

Add the new methods to all mock store instances across test/story files.

- [ ] **Step 6: Run tests and commit**

```
feat(frontend): add page mutation methods to document store (Spec 10c, Task 4)
```

---

## Task 5: Page thumbnail renderer

**Files:**
- Create: `frontend/src/panels/page-thumbnail.ts`

- [ ] **Step 1: Implement offscreen thumbnail renderer**

```typescript
const THUMBNAIL_WIDTH = 64;
const THUMBNAIL_HEIGHT = 48;

export function renderPageThumbnail(
  nodes: Record<string, DocumentNode>,
  pageRootUuids: string[],
  drawNodeFn: (ctx: CanvasRenderingContext2D, node: DocumentNode, transform: Transform) => void,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = THUMBNAIL_WIDTH * dpr;
  canvas.height = THUMBNAIL_HEIGHT * dpr;
  canvas.style.width = `${THUMBNAIL_WIDTH}px`;
  canvas.style.height = `${THUMBNAIL_HEIGHT}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.scale(dpr, dpr);

  // Calculate bounding box of all nodes on this page
  const bounds = computePageBounds(nodes, pageRootUuids);
  if (!bounds) return canvas; // empty page

  // Scale to fit thumbnail with padding
  const padding = 4;
  const availW = THUMBNAIL_WIDTH - padding * 2;
  const availH = THUMBNAIL_HEIGHT - padding * 2;
  const scale = Math.min(availW / bounds.width, availH / bounds.height, 1);
  const offsetX = padding + (availW - bounds.width * scale) / 2;
  const offsetY = padding + (availH - bounds.height * scale) / 2;

  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  ctx.translate(-bounds.x, -bounds.y);

  // Draw all root nodes and their children
  for (const uuid of pageRootUuids) {
    const node = nodes[uuid];
    if (!node || !node.visible) continue;
    drawNodeFn(ctx, node, node.transform);
  }

  return canvas;
}

function computePageBounds(
  nodes: Record<string, DocumentNode>,
  rootUuids: string[],
): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const uuid of rootUuids) {
    const node = nodes[uuid];
    if (!node || !node.visible) continue;
    const t = node.transform;
    if (!Number.isFinite(t.x) || !Number.isFinite(t.y)) continue;
    minX = Math.min(minX, t.x);
    minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x + t.width);
    maxY = Math.max(maxY, t.y + t.height);
  }

  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
```

- [ ] **Step 2: Run tests and commit**

```
feat(frontend): add page thumbnail offscreen renderer (Spec 10c, Task 5)
```

---

## Task 6: PageListItem component

**Files:**
- Create: `frontend/src/panels/PageListItem.tsx`
- Create: `frontend/src/panels/PageListItem.css`

- [ ] **Step 1: Implement PageListItem**

Each page row contains:
- Drag handle (6-dot grip icon)
- Thumbnail canvas (64x48)
- Page name (text, editable on double-click)
- Active indicator (highlight background)

```typescript
interface PageListItemProps {
  page: Page;
  isActive: boolean;
  onSelect: (pageId: string) => void;
  onRename: (pageId: string, newName: string) => void;
  onDelete: (pageId: string) => void;
  thumbnailCanvas: HTMLCanvasElement | null;
  isFocused: boolean;
}
```

Features:
- Click → `onSelect(page.id)`
- Double-click name → inline rename (contenteditable or text input)
- Enter/blur → commit rename
- Escape → cancel rename
- `role="option"` with `aria-selected={isActive}`
- Keyboard: F2 for rename, Delete for delete
- DnD: `useDraggable` on the drag handle

- [ ] **Step 2: Add styles**

Use CSS custom properties from theme.css. Active page gets highlighted background. Drag handle cursor: grab/grabbing.

- [ ] **Step 3: Commit**

```
feat(frontend): add PageListItem component (Spec 10c, Task 6)
```

---

## Task 7: PagesPanel component with DnD

**Files:**
- Create: `frontend/src/panels/PagesPanel.tsx` (replace placeholder)
- Create: `frontend/src/panels/PagesPanel.css`

- [ ] **Step 1: Implement PagesPanel**

```typescript
export const PagesPanel: Component = () => {
  const store = useDocument();
  const announce = useAnnounce();

  // Track focused page for keyboard navigation
  const [focusedIndex, setFocusedIndex] = createSignal(0);

  // Thumbnail cache — re-render on document changes (debounced)
  const [thumbnails, setThumbnails] = createSignal<Map<string, HTMLCanvasElement>>(new Map());

  // Render thumbnails when pages or nodes change
  createEffect(() => {
    const pages = store.state.pages;
    const nodes = store.state.nodes;
    // Debounce: use requestIdleCallback or setTimeout
    const newThumbnails = new Map<string, HTMLCanvasElement>();
    for (const page of pages) {
      const rootUuids = getRootNodeUuidsForPage(page, nodes);
      newThumbnails.set(page.id, renderPageThumbnail(nodes, rootUuids, drawNode));
    }
    setThumbnails(newThumbnails);
  });

  return (
    <div class="sigil-pages-panel" role="region" aria-label="Pages">
      <div class="sigil-pages-panel__header">
        <h3>Pages</h3>
        <button
          class="sigil-pages-panel__add-btn"
          aria-label="Add page"
          onClick={() => store.createPage(`Page ${store.state.pages.length + 1}`)}
        >
          +
        </button>
      </div>
      <div
        class="sigil-pages-panel__list"
        role="listbox"
        aria-label="Page list"
        onKeyDown={handleKeyDown}
      >
        <Index each={store.state.pages}>
          {(page, index) => (
            <PageListItem
              page={page()}
              isActive={store.activePageId() === page().id}
              isFocused={focusedIndex() === index}
              onSelect={(id) => store.setActivePage(id)}
              onRename={(id, name) => store.renamePage(id, name)}
              onDelete={(id) => store.deletePage(id)}
              thumbnailCanvas={thumbnails().get(page().id) ?? null}
            />
          )}
        </Index>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Add DnD reorder**

Wire `useDragDropMonitor` for page reorder:
- On drag start: announce "Grabbed [page name]"
- On drag over: compute insertion index from cursor Y position
- On drop: call `store.reorderPages(pageId, newIndex)`, announce "Moved to position N"
- Show drop indicator line between pages

- [ ] **Step 3: Add keyboard navigation**

```typescript
function handleKeyDown(e: KeyboardEvent) {
  const pages = store.state.pages;
  switch (e.key) {
    case "ArrowUp": // move focus up
    case "ArrowDown": // move focus down
    case "Enter": // select focused page
    case "F2": // rename focused page
    case "Delete": // delete focused page (guard: can't delete last)
  }
  // Alt+Arrow for reorder (CLAUDE.md §11 keyboard equivalents)
  if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    const pageId = pages[focusedIndex()].id;
    const newPos = e.key === "ArrowUp" ? focusedIndex() - 1 : focusedIndex() + 1;
    if (newPos >= 0 && newPos < pages.length) {
      store.reorderPages(pageId, newPos);
      setFocusedIndex(newPos);
      announce(`Moved ${pages[focusedIndex()].name} to position ${newPos + 1}`);
    }
  }
}
```

- [ ] **Step 4: Add styles and reduced-motion**

- [ ] **Step 5: Run tests and commit**

```
feat(frontend): implement PagesPanel with DnD reorder and keyboard navigation (Spec 10c, Task 7)
```

---

## Task 8: Wire page operations into apply-remote.ts

**Files:**
- Modify: `frontend/src/operations/apply-remote.ts`

- [ ] **Step 1: Add page operation handlers**

The subscription handler needs to process page create/delete/rename/reorder operations from other clients. Add handlers in `applyRemoteOperation` for:
- `op_type: "create_page"` → add page to store
- `op_type: "delete_page"` → remove page from store
- `op_type: "rename_page"` → update page name in store
- `op_type: "reorder_page"` → move page to new position in store

Each handler must use `produce()` to mutate `state.pages`.

- [ ] **Step 2: Run tests and commit**

```
feat(frontend): add page operation handlers to apply-remote (Spec 10c, Task 8)
```

---

## Task 9: Tests

**Files:**
- Create: `frontend/src/panels/__tests__/PagesPanel.test.tsx`

- [ ] **Step 1: Write tests**

Tests covering:
- Renders page list with correct number of items
- Active page is highlighted (`aria-selected`)
- Click selects page
- Add page button creates new page
- Delete page removes from list
- Cannot delete last page
- F2 enters rename mode
- Alt+ArrowUp/Down reorders pages
- Keyboard navigation (ArrowUp/Down)
- Thumbnail canvas is rendered for each page
- DnD reorder updates page order
- Screen reader announcements for reorder

- [ ] **Step 2: Run full test suites**

```bash
cargo test --workspace
cargo clippy --workspace -- -D warnings
pnpm --prefix frontend test
pnpm --prefix frontend lint
pnpm --prefix frontend build
```

- [ ] **Step 3: Commit**

```
test(frontend): add PagesPanel tests (Spec 10c, Task 9)
```

---

## Task 10: Integration verification

- [ ] **Step 1: Run all quality gates**

- [ ] **Step 2: Browser test**

Build and start the server. Test:
- Click "Pages" tab → pages panel visible with page list
- Click "+" → new page created with thumbnail
- Click page → navigates to it (canvas shows different nodes)
- Double-click name → rename inline
- Drag page to reorder → order updates
- Alt+Arrow → keyboard reorder
- Delete page → removed (can't delete last)
- Thumbnails render page contents

- [ ] **Step 3: Commit if needed**

```
test: integration verification for pages panel (Spec 10c, Task 10)
```

---

## Dependency Graph

```
Task 1 (ReorderPage core) → Task 2 (GraphQL) → Task 4 (Frontend store)
Task 1 → Task 3 (MCP tool)
Task 4 → Task 7 (PagesPanel component)
Task 5 (Thumbnails) → Task 6 (PageListItem) → Task 7
Task 7 → Task 8 (apply-remote)
Task 7 → Task 9 (Tests)
All → Task 10 (Integration)
```

Tasks 1, 5 are independent starting points. Tasks 2+3 follow Task 1. The frontend tasks (4-9) form a chain.
