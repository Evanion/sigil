# Review Findings — Gradient Editing (Spec 09d, PR #52)

**Branch:** feature/gradient-editing
**Date:** 2026-04-12

## Critical

### C-01 — Stop drag floods undo stack
- **Location:** `GradientControls.tsx`, `AppearancePanel.tsx`
- **Fix:** Add drag start/end lifecycle, snapshot fills on drag start, suppress history during drag, commit single entry on drag end
- **Status:** open

### C-02 — onCleanup inside event handler
- **Location:** `GradientStopEditor.tsx:117`
- **Fix:** Move onCleanup to component top level, store timer ref in module scope
- **Status:** open

## High

### H-01 — Missing radial Radius control
- **Location:** `GradientControls.tsx`
- **Fix:** Add Radius NumberInput (0-100%), compute end point from start + radius
- **Status:** open

### H-02 — Constant enforcement tests verify value not enforcement
- **Location:** `gradient-utils.test.ts`
- **Fix:** Add canAddStop/canRemoveStop helpers, test actual rejection
- **Status:** open

### H-03 — stopsWithIds re-assigns UUIDs after every update
- **Location:** `GradientControls.tsx`
- **Fix:** Don't strip IDs before onUpdate, filter at store boundary only
- **Status:** open

## Medium

### M-01 — Gradient rendering math deviation
- **Fix:** Add code comment + renderer test documenting point-based approach
- **Status:** open

### M-02 — Stop aria-label redundant with aria-valuetext
- **Fix:** Change aria-label to static "Color stop"
- **Status:** open

### M-03 — No renderer tests for gradient fills
- **Fix:** Add linear + radial gradient renderer tests
- **Status:** open

### M-04 — Remove button tabIndex={-1}
- **Fix:** Change to tabIndex={0}
- **Status:** open

## Low

### L-01 — handleUpdateStop doesn't clamp position
- **Fix:** Add clamp inside handleUpdateStop
- **Status:** open

### L-02 — Default angle 90° inconsistent with spec 180°
- **Fix:** Change default to 180
- **Status:** open

### L-03 — Missing GradientControls.test.tsx
- **Fix:** Add test file
- **Status:** open
