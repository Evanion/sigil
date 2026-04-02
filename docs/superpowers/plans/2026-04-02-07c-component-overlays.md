# Component Library: Overlays & Feedback — Implementation Plan (07c)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the overlay and feedback components (Popover, ContextMenu, DropdownMenu, Dialog, Toast, Menubar) — the interactive layers for menus, panels, modals, notifications, and application menubar.

**Architecture:** Same pattern as 07b — each component wraps a Kobalte headless primitive, styled with CSS custom properties, 4 files per component. Overlays use Kobalte's Portal for rendering outside the DOM tree. Menu components (ContextMenu, DropdownMenu, Menubar) share similar item styling patterns.

**Tech Stack:** Solid.js 1.9, Kobalte 0.13, Open Props, Lucide-Solid, Storybook 10, Vitest 4

**IMPORTANT:** Your FIRST action before writing ANY code must be to read `CLAUDE.md` in full. Follow the exact pattern from `frontend/src/components/button/`. TypeScript strict, no `any`, no innerHTML.

---

## File Structure

```
frontend/src/components/
├── popover/
│   ├── Popover.tsx, Popover.css, Popover.stories.tsx, Popover.test.tsx
├── context-menu/
│   ├── ContextMenu.tsx, ContextMenu.css, ContextMenu.stories.tsx, ContextMenu.test.tsx
├── dropdown-menu/
│   ├── DropdownMenu.tsx, DropdownMenu.css, DropdownMenu.stories.tsx, DropdownMenu.test.tsx
├── dialog/
│   ├── Dialog.tsx, Dialog.css, Dialog.stories.tsx, Dialog.test.tsx
├── toast/
│   ├── Toast.tsx, Toast.css, Toast.stories.tsx, Toast.test.tsx
├── menubar/
│   ├── Menubar.tsx, Menubar.css, Menubar.stories.tsx, Menubar.test.tsx
```

---

## Task 1: Popover component

**Files:**
- Create: `frontend/src/components/popover/Popover.tsx`
- Create: `frontend/src/components/popover/Popover.css`
- Create: `frontend/src/components/popover/Popover.stories.tsx`
- Create: `frontend/src/components/popover/Popover.test.tsx`

- [ ] 1. Read `CLAUDE.md` in full. Read existing Button component for pattern.

- [ ] 2. Write tests, then implement.

Component wraps `@kobalte/core/popover`. Floating content panel (used for color pickers, detail panels).

Props:
```typescript
export interface PopoverProps {
  /** The trigger element that opens the popover. */
  trigger: JSX.Element;
  /** Content rendered inside the popover panel. */
  children: JSX.Element;
  /** Placement relative to trigger. Defaults to "bottom". */
  placement?: "top" | "bottom" | "left" | "right";
  /** Additional CSS class on the content panel. */
  class?: string;
}
```

CSS classes: `sigil-popover` (content), `sigil-popover__arrow`
- Content: surface-3 bg, border-2 border, radius-2, shadow-3, padding size-3, z-index 50
- Arrow: surface-3 fill

Tests: trigger renders, clicking trigger opens content, content has base class, content contains children, custom class on content.

Stories: Default (with a Button trigger and placeholder content), Placement variants.

- [ ] 3. Run tests, lint, build.
- [ ] 4. Commit: `feat(frontend): add Popover component with Kobalte (spec-07)`

---

## Task 2: ContextMenu component

**Files:**
- Create: `frontend/src/components/context-menu/ContextMenu.tsx`
- Create: `frontend/src/components/context-menu/ContextMenu.css`
- Create: `frontend/src/components/context-menu/ContextMenu.stories.tsx`
- Create: `frontend/src/components/context-menu/ContextMenu.test.tsx`

- [ ] 1. Read `CLAUDE.md` in full. Read existing Button component for pattern.

- [ ] 2. Write tests, then implement.

Component wraps `@kobalte/core/context-menu`. Right-click menu for layers panel, canvas.

Props:
```typescript
export interface ContextMenuItem {
  /** Unique key for the item. */
  key: string;
  /** Display label. */
  label: string;
  /** Whether the item is disabled. */
  disabled?: boolean;
  /** Keyboard shortcut hint displayed on the right. */
  shortcut?: string;
}

export interface ContextMenuProps {
  /** The area that triggers the context menu on right-click. */
  children: JSX.Element;
  /** Menu items to display. */
  items: readonly ContextMenuItem[];
  /** Callback when an item is selected. */
  onSelect: (key: string) => void;
  /** Additional CSS class on the menu content. */
  class?: string;
}
```

CSS classes: `sigil-context-menu` (content), `sigil-context-menu__item`, `sigil-context-menu__shortcut`
- Content: surface-3 bg, border-2 border, radius-2, shadow-3, padding size-1 0, z-50
- Item: padding size-1 size-3, flex between, hover surface-4, disabled text-3 + no pointer
- Shortcut: text-3, font-size-00, ml auto

Tests: trigger area renders children, right-click opens menu, items render with labels, onSelect fires with correct key, disabled items rendered, custom class.

Stories: Default (right-click area with layer actions), WithShortcuts, WithDisabledItems.

- [ ] 3. Run tests, lint, build.
- [ ] 4. Commit: `feat(frontend): add ContextMenu component with Kobalte (spec-07)`

---

## Task 3: DropdownMenu component

**Files:**
- Create: `frontend/src/components/dropdown-menu/DropdownMenu.tsx`
- Create: `frontend/src/components/dropdown-menu/DropdownMenu.css`
- Create: `frontend/src/components/dropdown-menu/DropdownMenu.stories.tsx`
- Create: `frontend/src/components/dropdown-menu/DropdownMenu.test.tsx`

- [ ] 1. Read `CLAUDE.md` in full. Read existing Button component for pattern.

- [ ] 2. Write tests, then implement.

Component wraps `@kobalte/core/dropdown-menu`. Click-triggered menu (e.g., page actions, export menu).

Props:
```typescript
export interface DropdownMenuItem {
  key: string;
  label: string;
  disabled?: boolean;
  shortcut?: string;
}

export interface DropdownMenuProps {
  /** The trigger element (usually a Button or IconButton). */
  trigger: JSX.Element;
  /** Menu items to display. */
  items: readonly DropdownMenuItem[];
  /** Callback when an item is selected. */
  onSelect: (key: string) => void;
  /** Additional CSS class on the menu content. */
  class?: string;
}
```

CSS classes: `sigil-dropdown-menu` (content), `sigil-dropdown-menu__item`, `sigil-dropdown-menu__shortcut`
- Same visual styling as ContextMenu (shared menu aesthetics).

Tests: trigger renders, clicking opens menu, items render, onSelect callback, disabled items, custom class.

Stories: Default (with Button trigger), WithShortcuts, WithDisabledItems.

- [ ] 3. Run tests, lint, build.
- [ ] 4. Commit: `feat(frontend): add DropdownMenu component with Kobalte (spec-07)`

---

## Task 4: Dialog component

**Files:**
- Create: `frontend/src/components/dialog/Dialog.tsx`
- Create: `frontend/src/components/dialog/Dialog.css`
- Create: `frontend/src/components/dialog/Dialog.stories.tsx`
- Create: `frontend/src/components/dialog/Dialog.test.tsx`

- [ ] 1. Read `CLAUDE.md` in full. Read existing Button component for pattern.

- [ ] 2. Write tests, then implement.

Component wraps `@kobalte/core/dialog`. Modal dialog for export settings, preferences, etc.

Props:
```typescript
export interface DialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Callback when open state changes (e.g., close button, overlay click, Escape). */
  onOpenChange: (open: boolean) => void;
  /** Dialog title displayed in the header. */
  title: string;
  /** Optional description below the title. */
  description?: string;
  /** Dialog body content. */
  children: JSX.Element;
  /** Additional CSS class on the dialog content panel. */
  class?: string;
}
```

CSS classes: `sigil-dialog__overlay`, `sigil-dialog`, `sigil-dialog__header`, `sigil-dialog__title`, `sigil-dialog__description`, `sigil-dialog__body`, `sigil-dialog__close`
- Overlay: fixed inset 0, black/50% opacity, z-50
- Content: fixed center, surface-2 bg, border-2 border, radius-3, shadow-5, min-width 400px, max-width 90vw, max-height 85vh, z-50
- Header: flex between, padding size-4, border-bottom
- Title: font-size-1, font-weight-6, text-1
- Description: font-size-0, text-2
- Close button: X icon, top-right of header
- Body: padding size-4, overflow-y auto

Uses Lucide `X` icon (size 16) for close button.

Tests: renders with title when open, does not render when closed, fires onOpenChange(false) on close button click, shows description when provided, renders children in body, has dialog role, custom class.

Stories: Default (with trigger button that opens it), WithDescription, WithForm (shows form content inside).

- [ ] 3. Run tests, lint, build.
- [ ] 4. Commit: `feat(frontend): add Dialog component with Kobalte (spec-07)`

---

## Task 5: Toast component

**Files:**
- Create: `frontend/src/components/toast/Toast.tsx`
- Create: `frontend/src/components/toast/Toast.css`
- Create: `frontend/src/components/toast/Toast.stories.tsx`
- Create: `frontend/src/components/toast/Toast.test.tsx`

- [ ] 1. Read `CLAUDE.md` in full. Read existing Button component for pattern.

- [ ] 2. Write tests, then implement.

Component wraps `@kobalte/core/toast`. Temporary notifications for save confirmations, errors, etc.

This component has two parts:
1. `ToastRegion` — mounted once at app root, renders the toast list
2. `toaster` — imperative API to show toasts from anywhere

```typescript
export type ToastVariant = "info" | "success" | "error" | "warning";

export interface ToastData {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

// Imperative API
export function showToast(data: ToastData): void;

// Region component (mount once in app shell)
export function ToastRegion(): JSX.Element;
```

CSS classes: `sigil-toast-region`, `sigil-toast`, `sigil-toast--success`, `sigil-toast--error`, `sigil-toast--warning`, `sigil-toast__title`, `sigil-toast__description`, `sigil-toast__close`
- Region: fixed bottom-right, z-50, flex column, gap size-2
- Toast: surface-3 bg, border-2 border, radius-2, shadow-3, padding size-3, min-width 280px
- Variant borders: success uses --success, error uses --danger, warning uses --warning
- Close: X icon top-right
- Auto-dismiss after 5 seconds (Kobalte default)

Uses Lucide `X` icon (size 14) for close button.

Tests: ToastRegion renders a region element, showToast displays a toast with title, toast with description, variant class applied. Note: Kobalte's toast requires `toaster.create()` from their toast API.

Stories: Variants (buttons that trigger each variant), WithDescription.

- [ ] 3. Run tests, lint, build.
- [ ] 4. Commit: `feat(frontend): add Toast component with Kobalte (spec-07)`

---

## Task 6: Menubar component

**Files:**
- Create: `frontend/src/components/menubar/Menubar.tsx`
- Create: `frontend/src/components/menubar/Menubar.css`
- Create: `frontend/src/components/menubar/Menubar.stories.tsx`
- Create: `frontend/src/components/menubar/Menubar.test.tsx`

- [ ] 1. Read `CLAUDE.md` in full. Read existing Button component for pattern.

- [ ] 2. Write tests, then implement.

Component wraps `@kobalte/core/menubar`. Application-level top menu bar (File, Edit, View, Insert, etc.).

```typescript
export interface MenubarItem {
  key: string;
  label: string;
  disabled?: boolean;
  shortcut?: string;
}

export interface MenubarMenu {
  /** Trigger label (e.g., "File", "Edit"). */
  label: string;
  /** Items in this menu. */
  items: readonly MenubarItem[];
}

export interface MenubarProps {
  /** The menus to display in the bar. */
  menus: readonly MenubarMenu[];
  /** Callback when any menu item is selected. */
  onSelect: (menuLabel: string, itemKey: string) => void;
  /** Additional CSS class on the root. */
  class?: string;
}
```

CSS classes: `sigil-menubar` (root), `sigil-menubar__trigger`, `sigil-menubar__content`, `sigil-menubar__item`, `sigil-menubar__shortcut`
- Root: flex row, surface-2 bg, border-bottom border-1, height 28px, align center, padding 0 size-2, role="menubar"
- Trigger: padding size-1 size-2, font-size-00, text-2, hover surface-4, no border, bg transparent
- Content: same visual style as dropdown/context menus (surface-3, border, shadow, z-50)
- Items: same visual style as dropdown menu items

Tests: renders menubar role, renders trigger labels, clicking trigger opens menu, items render, onSelect fires with menu label and item key, custom class.

Stories: Default (File/Edit/View menus with typical items), WithShortcuts.

- [ ] 3. Run tests, lint, build.
- [ ] 4. Commit: `feat(frontend): add Menubar component with Kobalte (spec-07)`

---

## Task 7: Full verification

- [ ] 1. `cd frontend && pnpm test`
- [ ] 2. `cd frontend && pnpm lint`
- [ ] 3. `cd frontend && pnpm build`
- [ ] 4. `cd frontend && pnpm format`
- [ ] 5. `cd frontend && pnpm build-storybook`
- [ ] 6. Fix any issues, commit.
