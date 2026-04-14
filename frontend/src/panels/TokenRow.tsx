/**
 * A single token row in the TokensPanel list.
 *
 * Displays a type icon, token name (editable via F2/double-click/requestRename),
 * and a value preview. Supports keyboard navigation via roving tabindex.
 */

import { createSignal, createEffect, Show, splitProps, type Component } from "solid-js";
import type { Token, TokenValue, Color } from "../types/document";
import { MAX_TOKEN_NAME_LENGTH } from "../store/document-store-solid";
import "./TokenRow.css";

// ── Props ──────────────────────────────────────────────────────────────────

export interface TokenRowProps {
  readonly token: Token;
  readonly isSelected: boolean;
  readonly onSelect: (name: string) => void;
  readonly onRename: (name: string, newName: string) => void;
  readonly onDelete: (name: string) => void;
  readonly onEdit: (name: string) => void;
  readonly isFocused: boolean;
  readonly tabIndex: number;
  /** When true, immediately enters rename mode. */
  readonly requestRename?: boolean;
  /** Called after rename mode is entered from requestRename, to reset the signal. */
  readonly onRenameStarted?: () => void;
}

// ── Color helpers ──────────────────────────────────────────────────────────

/**
 * Convert a sRGB color channel value (0..1) to a two-character hex string.
 * Guards against NaN/Infinity per CLAUDE.md floating-point validation rules.
 */
function channelToHex(value: number): string {
  // Guard: NaN or Infinity → treat as 0.
  const safe = Number.isFinite(value) ? value : 0;
  const clamped = Math.max(0, Math.min(1, safe));
  return Math.round(clamped * 255)
    .toString(16)
    .padStart(2, "0");
}

/**
 * Render a Color to a CSS hex string for the color swatch.
 * Only sRGB colors are rendered as hex; others fall back to gray.
 */
function colorToHex(color: Color): string | null {
  if (color.space !== "srgb") return null;
  return `#${channelToHex(color.r)}${channelToHex(color.g)}${channelToHex(color.b)}`;
}

/**
 * Render a Color to a display hex string (without alpha for value preview).
 */
function colorToHexPreview(color: Color): string {
  if (color.space !== "srgb") return "—";
  return `#${channelToHex(color.r)}${channelToHex(color.g)}${channelToHex(color.b)}`;
}

// ── Value preview ──────────────────────────────────────────────────────────

/**
 * Build a short human-readable preview string for a token value.
 * All numeric values are guarded against NaN/Infinity per CLAUDE.md.
 */
export function buildValuePreview(value: TokenValue): string {
  switch (value.type) {
    case "color":
      return colorToHexPreview(value.value);

    case "dimension": {
      // Guard: NaN/Infinity on value.value
      const v = Number.isFinite(value.value) ? value.value : 0;
      return `${v}${value.unit}`;
    }

    case "number": {
      const v = Number.isFinite(value.value) ? value.value : 0;
      return String(v);
    }

    case "font_family":
      return value.families[0] ?? "—";

    case "font_weight": {
      const w = Number.isFinite(value.weight) ? value.weight : 0;
      return String(w);
    }

    case "typography": {
      const { font_family, font_size, font_weight } = value.value;
      const size = Number.isFinite(font_size) ? font_size : 0;
      const weight = Number.isFinite(font_weight) ? font_weight : 0;
      return `${font_family} ${size}/${weight}`;
    }

    case "shadow": {
      const { offset, blur, color } = value.value;
      const x = Number.isFinite(offset.x) ? offset.x : 0;
      const y = Number.isFinite(offset.y) ? offset.y : 0;
      const b = Number.isFinite(blur) ? blur : 0;
      const hex = colorToHexPreview(color);
      return `${x} ${y} ${b} ${hex}`;
    }

    case "gradient": {
      // Determine gradient type by inspecting start/end positions.
      // A radial gradient has equal start/end (center-based), otherwise linear.
      // For simplicity, label based on positions being distinct.
      const { start, end } = value.gradient;
      const isRadial =
        Number.isFinite(start.x) &&
        Number.isFinite(end.x) &&
        Math.abs(start.x - end.x) < 0.001 &&
        Math.abs(start.y - end.y) < 0.001;
      return isRadial ? "Radial" : "Linear";
    }

    case "alias":
      return `\u2192 ${value.name}`;

    case "duration": {
      const s = Number.isFinite(value.seconds) ? value.seconds : 0;
      return `${s}s`;
    }

    case "cubic_bezier": {
      const [p1x, p1y, p2x, p2y] = value.values;
      // Check for well-known named easings
      if (p1x === 0 && p1y === 0 && p2x === 1 && p2y === 1) return "linear";
      if (p1x === 0.25 && p1y === 0.1 && p2x === 0.25 && p2y === 1) return "ease";
      if (p1x === 0.42 && p1y === 0 && p2x === 1 && p2y === 1) return "ease-in";
      if (p1x === 0 && p1y === 0 && p2x === 0.58 && p2y === 1) return "ease-out";
      if (p1x === 0.42 && p1y === 0 && p2x === 0.58 && p2y === 1) return "ease-in-out";
      // Fallback: show raw control points
      const fmt = (n: number): string => (Number.isFinite(n) ? String(n) : "0");
      return `${fmt(p1x)}, ${fmt(p1y)}, ${fmt(p2x)}, ${fmt(p2y)}`;
    }

    default: {
      // Exhaustive check — TypeScript should catch missing cases
      const _exhaustive: never = value;
      void _exhaustive;
      return "—";
    }
  }
}

// ── Type icon ──────────────────────────────────────────────────────────────

interface TypeIconProps {
  value: TokenValue;
}

/**
 * Renders a small visual indicator for the token type.
 * Color tokens show a 12×12 filled swatch; others show a text glyph.
 */
const TypeIcon: Component<TypeIconProps> = (props) => {
  const glyphMap: Partial<Record<TokenValue["type"], string>> = {
    dimension: "\u2194",
    number: "#",
    font_family: "Aa",
    font_weight: "W",
    typography: "T",
    shadow: "\u25D0",
    gradient: "\u2207",
    duration: "\u23F1",
    cubic_bezier: "\u2312",
    alias: "\u2192",
  };

  const swatchColor = (): string | null => {
    if (props.value.type !== "color") return null;
    return colorToHex(props.value.value);
  };

  return (
    <Show
      when={props.value.type === "color"}
      fallback={
        <span class="sigil-token-row__icon" aria-hidden="true">
          {glyphMap[props.value.type] ?? "?"}
        </span>
      }
    >
      <span class="sigil-token-row__icon sigil-token-row__icon--color" aria-hidden="true">
        <span
          class="sigil-token-row__color-swatch"
          style={{ background: swatchColor() ?? "var(--text-3)" }}
        />
      </span>
    </Show>
  );
};

// ── TokenRow ───────────────────────────────────────────────────────────────

export const TokenRow: Component<TokenRowProps> = (rawProps) => {
  const [props] = splitProps(rawProps, [
    "token",
    "isSelected",
    "onSelect",
    "onRename",
    "onDelete",
    "onEdit",
    "isFocused",
    "tabIndex",
    "requestRename",
    "onRenameStarted",
  ]);

  const [isRenaming, setIsRenaming] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;

  // Enter rename mode when parent requests it (replaces synthetic dblclick).
  createEffect(() => {
    if (props.requestRename) {
      startRename();
      props.onRenameStarted?.();
    }
  });

  function startRename(): void {
    setIsRenaming(true);
    requestAnimationFrame(() => {
      inputRef?.focus();
      inputRef?.select();
    });
  }

  function commitRename(): void {
    const value = inputRef?.value.trim();
    if (value && value !== props.token.name) {
      props.onRename(props.token.name, value);
    }
    setIsRenaming(false);
  }

  function handleRenameKeyDown(e: KeyboardEvent): void {
    // Stop propagation to prevent document-level shortcut handlers
    // from acting during overlay edit mode (CLAUDE.md: overlay-mode keyboard handlers).
    e.stopPropagation();

    if (e.key === "Enter") {
      e.preventDefault();
      commitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsRenaming(false);
    }
  }

  function handleItemKeyDown(e: KeyboardEvent): void {
    if (isRenaming()) return;

    if (e.key === "F2") {
      e.preventDefault();
      startRename();
    } else if (e.key === "Delete") {
      e.preventDefault();
      props.onDelete(props.token.name);
    }
  }

  const valuePreview = () => buildValuePreview(props.token.value);
  const isAlias = () => props.token.value.type === "alias";

  return (
    <div
      class="sigil-token-row"
      classList={{
        "sigil-token-row--selected": props.isSelected,
        "sigil-token-row--focused": props.isFocused,
      }}
      role="option"
      aria-selected={props.isSelected}
      tabindex={props.tabIndex}
      data-token-name={props.token.name}
      onClick={() => props.onSelect(props.token.name)}
      onDblClick={() => props.onEdit(props.token.name)}
      onKeyDown={handleItemKeyDown}
    >
      <TypeIcon value={props.token.value} />

      <Show
        when={!isRenaming()}
        fallback={
          <input
            ref={(el) => {
              inputRef = el;
            }}
            class="sigil-token-row__name-input"
            aria-label={`Rename token ${props.token.name}`}
            value={props.token.name}
            maxLength={MAX_TOKEN_NAME_LENGTH}
            onBlur={commitRename}
            onKeyDown={handleRenameKeyDown}
          />
        }
      >
        <span class="sigil-token-row__name">{props.token.name}</span>
      </Show>

      <span
        class="sigil-token-row__value"
        classList={{ "sigil-token-row__value--alias": isAlias() }}
        aria-label={`Value: ${valuePreview()}`}
      >
        {valuePreview()}
      </span>
    </div>
  );
};
