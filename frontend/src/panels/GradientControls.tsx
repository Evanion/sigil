/**
 * GradientControls — wraps GradientStopEditor with type-specific controls
 * and selected-stop editing (color, position, remove).
 *
 * Manages local state: selectedStopId signal, stops with assigned IDs.
 * When any value changes, reconstructs the Fill object and calls onUpdate.
 *
 * Uses stable stop IDs per CLAUDE.md "Do Not Use Positional Index as
 * Item Identity in Dynamic Lists".
 *
 * All numeric values are guarded with Number.isFinite() per CLAUDE.md.
 */
import { createMemo, createSignal, Show } from "solid-js";
import { useTransContext } from "@mbarzda/solid-i18next";
import { Trash2 } from "lucide-solid";
import type {
  Color,
  Fill,
  FillConicGradient,
  FillLinearGradient,
  FillRadialGradient,
  GradientStop,
  StyleValue,
} from "../types/document";
import { GradientStopEditor } from "../components/gradient-editor/GradientStopEditor";
import { ColorSwatch } from "../components/color-picker";
import { NumberInput } from "../components/number-input/NumberInput";
import {
  assignStopIds,
  angleFromPoints,
  pointsFromAngle,
  stopsToLinearGradientCSS,
  interpolateStopColor,
  MIN_GRADIENT_STOPS,
  MAX_GRADIENT_STOPS,
} from "../components/gradient-editor/gradient-utils";
import "./GradientControls.css";

// ── Named constants for NumberInput bounds (CLAUDE.md §11) ───────────

/** Minimum gradient angle in degrees. */
const ANGLE_MIN = 0;

/** Maximum gradient angle in degrees. */
const ANGLE_MAX = 360;

/** Minimum stop position percentage. */
const POSITION_MIN = 0;

/** Maximum stop position percentage. */
const POSITION_MAX = 100;

/** Minimum center coordinate percentage. */
const CENTER_MIN = 0;

/** Maximum center coordinate percentage. */
const CENTER_MAX = 100;

/** Minimum radial gradient radius percentage. */
const RADIUS_MIN = 0;

/** Maximum radial gradient radius percentage. */
const RADIUS_MAX = 100;

export interface GradientControlsProps {
  readonly fill: FillLinearGradient | FillRadialGradient | FillConicGradient;
  readonly onUpdate: (fill: Fill) => void;
  /**
   * Called when a continuous drag gesture begins (e.g., stop drag).
   * Parent should flush any pending history buffer so the drag starts
   * a fresh coalesce window. See CLAUDE.md "Continuous-Value Controls
   * Must Coalesce History Entries".
   */
  readonly onDragStart?: () => void;
  /**
   * Called when a continuous drag gesture ends. Parent should flush
   * the history buffer to commit the entire drag as a single undo entry.
   */
  readonly onDragEnd?: () => void;
}

export function GradientControls(props: GradientControlsProps) {
  const [t] = useTransContext();
  const [selectedStopId, setSelectedStopId] = createSignal<string | null>(null);

  // ── Derived: stops with stable IDs ──────────────────────────────────
  const stopsWithIds = createMemo((): GradientStop[] => {
    return assignStopIds(props.fill.gradient.stops);
  });

  // The stop bar always shows a simple left-to-right gradient preview
  // regardless of the actual gradient type or angle. The bar represents
  // the color distribution along the gradient axis, not the spatial direction.
  const gradientCSS = createMemo((): string => {
    const stops = stopsWithIds();
    const sorted = [...stops].sort((a, b) => a.position - b.position);
    return stopsToLinearGradientCSS(sorted, 90);
  });

  // ── Derived: current angle for linear gradients ─────────────────────
  const currentAngle = createMemo((): number => {
    if (props.fill.type !== "linear_gradient") return 0;
    const a = angleFromPoints(props.fill.gradient.start, props.fill.gradient.end);
    return Number.isFinite(a) ? Math.round(a) : 0;
  });

  // ── Derived: current radius for radial gradients ───────────────────
  const currentRadius = createMemo((): number => {
    if (props.fill.type !== "radial_gradient") return 50;
    const s = props.fill.gradient.start;
    const e = props.fill.gradient.end;
    const dx = (Number.isFinite(e.x) ? e.x : 1) - (Number.isFinite(s.x) ? s.x : 0.5);
    const dy = (Number.isFinite(e.y) ? e.y : 0.5) - (Number.isFinite(s.y) ? s.y : 0.5);
    // dx*dx + dy*dy is always >= 0, so Math.sqrt is safe here
    const r = Math.sqrt(dx * dx + dy * dy);
    return Number.isFinite(r) ? Math.round(r * 100) : 50;
  });

  // ── Derived: current start angle for conic gradients ────────────────
  const currentConicAngle = createMemo((): number => {
    if (props.fill.type !== "conic_gradient") return 0;
    const a = props.fill.gradient.start_angle;
    return Number.isFinite(a) ? Math.round(a) : 0;
  });

  // ── Derived: selected stop data ─────────────────────────────────────
  const selectedStop = createMemo((): GradientStop | null => {
    const id = selectedStopId();
    if (!id) return null;
    return stopsWithIds().find((s) => s.id === id) ?? null;
  });

  // ── Derived: selected stop color ────────────────────────────────────
  const selectedStopColor = createMemo((): Color => {
    const stop = selectedStop();
    if (!stop) return { space: "srgb", r: 0, g: 0, b: 0, a: 1 };
    if (stop.color.type === "literal") return stop.color.value;
    return { space: "srgb", r: 0, g: 0, b: 0, a: 1 };
  });

  // ── Helpers: rebuild fill from modified stops ───────────────────────

  function rebuildFill(newStops: GradientStop[]): Fill {
    // Preserve `id` fields on stops — they are harmless extra fields that
    // the server ignores, and stripping them causes assignStopIds to
    // re-assign new UUIDs on every update, breaking stable selection identity.
    if (props.fill.type === "linear_gradient") {
      return {
        type: "linear_gradient",
        gradient: {
          ...props.fill.gradient,
          stops: newStops,
        },
      };
    }
    if (props.fill.type === "conic_gradient") {
      return {
        type: "conic_gradient",
        gradient: {
          ...props.fill.gradient,
          stops: newStops,
        },
      };
    }
    return {
      type: "radial_gradient",
      gradient: {
        ...props.fill.gradient,
        stops: newStops,
      },
    };
  }

  // ── Stop callbacks ──────────────────────────────────────────────────

  function handleSelectStop(id: string): void {
    setSelectedStopId(id);
  }

  function handleUpdateStop(id: string, position: number): void {
    if (!Number.isFinite(position)) return;
    // Clamp: slider affordance — user drags a stop within the 0-1 bar range
    const clamped = Math.max(0, Math.min(1, position));
    const stops = stopsWithIds();
    const newStops = stops.map((s) => (s.id === id ? { ...s, position: clamped } : s));
    props.onUpdate(rebuildFill(newStops));
  }

  function handleAddStop(position: number): void {
    if (!Number.isFinite(position)) return;
    const stops = stopsWithIds();
    if (stops.length >= MAX_GRADIENT_STOPS) return;

    // Interpolate color at the new position
    const sorted = [...stops].sort((a, b) => a.position - b.position);
    const color = interpolateStopColor(sorted, position);
    const colorValue: StyleValue<Color> = { type: "literal", value: color };

    const newId = crypto.randomUUID();
    const newStop: GradientStop = {
      id: newId,
      position,
      color: colorValue,
    };

    const newStops = [...stops, newStop];
    props.onUpdate(rebuildFill(newStops));
    setSelectedStopId(newId);
  }

  function handleRemoveStop(id: string): void {
    const stops = stopsWithIds();
    if (stops.length <= MIN_GRADIENT_STOPS) return;
    const newStops = stops.filter((s) => s.id !== id);
    props.onUpdate(rebuildFill(newStops));

    // If removed stop was selected, select nearest remaining
    if (selectedStopId() === id) {
      const idx = stops.findIndex((s) => s.id === id);
      const newIdx = Math.min(idx, newStops.length - 1);
      const nextStop = newStops[newIdx];
      setSelectedStopId(nextStop?.id ?? null);
    }
  }

  // ── Selected stop color change ──────────────────────────────────────

  function handleStopColorChange(newColor: Color): void {
    const id = selectedStopId();
    if (!id) return;
    const stops = stopsWithIds();
    const colorValue: StyleValue<Color> = { type: "literal", value: newColor };
    const newStops = stops.map((s) => (s.id === id ? { ...s, color: colorValue } : s));
    props.onUpdate(rebuildFill(newStops));
  }

  // ── Selected stop position change (from NumberInput, 0-100%) ────────

  function handleStopPositionChange(pct: number): void {
    if (!Number.isFinite(pct)) return;
    const id = selectedStopId();
    if (!id) return;
    const position = pct / 100;
    if (!Number.isFinite(position)) return;
    handleUpdateStop(id, Math.max(0, Math.min(1, position)));
  }

  // ── Angle change (linear only) ──────────────────────────────────────

  function handleAngleChange(angleDeg: number): void {
    if (!Number.isFinite(angleDeg)) return;
    if (props.fill.type !== "linear_gradient") return;
    const { start, end } = pointsFromAngle(angleDeg);
    const stops = stopsWithIds();
    const newFill: FillLinearGradient = {
      type: "linear_gradient",
      gradient: {
        stops,
        start,
        end,
        repeating: props.fill.gradient.repeating,
      },
    };
    props.onUpdate(newFill);
  }

  // ── Conic angle change ──────────────────────────────────────────────

  function handleConicAngleChange(angleDeg: number): void {
    if (!Number.isFinite(angleDeg)) return;
    if (props.fill.type !== "conic_gradient") return;
    const stops = stopsWithIds();
    const newFill: FillConicGradient = {
      type: "conic_gradient",
      gradient: {
        ...props.fill.gradient,
        start_angle: angleDeg,
        stops,
      },
    };
    props.onUpdate(newFill);
  }

  // ── Reverse gradient ────────────────────────────────────────────────

  function handleReverse(): void {
    const stops = stopsWithIds();
    const reversed = stops.map((s) => ({
      ...s,
      position: Number.isFinite(s.position) ? 1 - s.position : s.position,
    }));
    reversed.reverse();
    props.onUpdate(rebuildFill(reversed));
  }

  // ── Center X/Y change (radial only) ─────────────────────────────────

  function handleCenterXChange(pct: number): void {
    if (!Number.isFinite(pct)) return;
    if (props.fill.type !== "radial_gradient") return;
    const cx = pct / 100;
    if (!Number.isFinite(cx)) return;
    const stops = stopsWithIds();
    const newFill: FillRadialGradient = {
      type: "radial_gradient",
      gradient: {
        stops,
        start: { x: cx, y: props.fill.gradient.start.y },
        end: props.fill.gradient.end,
        repeating: props.fill.gradient.repeating,
      },
    };
    props.onUpdate(newFill);
  }

  function handleCenterYChange(pct: number): void {
    if (!Number.isFinite(pct)) return;
    if (props.fill.type !== "radial_gradient") return;
    const cy = pct / 100;
    if (!Number.isFinite(cy)) return;
    const stops = stopsWithIds();
    const newFill: FillRadialGradient = {
      type: "radial_gradient",
      gradient: {
        stops,
        start: { x: props.fill.gradient.start.x, y: cy },
        end: props.fill.gradient.end,
        repeating: props.fill.gradient.repeating,
      },
    };
    props.onUpdate(newFill);
  }

  // ── Radius change (radial only) ─────────────────────────────────────

  function handleRadiusChange(pct: number): void {
    if (!Number.isFinite(pct)) return;
    if (props.fill.type !== "radial_gradient") return;
    const r = pct / 100;
    if (!Number.isFinite(r)) return;
    const start = props.fill.gradient.start;
    // Set end point at (start.x + r, start.y) — radius in X direction
    const newEnd = { x: start.x + r, y: start.y };
    const stops = stopsWithIds();
    const newFill: FillRadialGradient = {
      type: "radial_gradient",
      gradient: {
        stops,
        start,
        end: newEnd,
        repeating: props.fill.gradient.repeating,
      },
    };
    props.onUpdate(newFill);
  }

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div class="sigil-gradient-controls" role="group" aria-label="Gradient controls">
      {/* Stop editor bar */}
      <GradientStopEditor
        stops={stopsWithIds()}
        selectedStopId={selectedStopId()}
        onSelectStop={handleSelectStop}
        onUpdateStop={handleUpdateStop}
        onAddStop={handleAddStop}
        onRemoveStop={handleRemoveStop}
        gradientCSS={gradientCSS()}
        onDragStart={props.onDragStart}
        onDragEnd={props.onDragEnd}
      />

      {/* Selected stop detail row */}
      <Show when={selectedStop()}>
        <div class="sigil-gradient-controls__stop-detail" role="group" aria-label="Selected stop">
          <ColorSwatch
            color={selectedStopColor()}
            onColorChange={handleStopColorChange}
            aria-label={t("panels:gradient.stopColor")}
          />

          <NumberInput
            value={Math.round((selectedStop()?.position ?? 0) * 100)}
            onValueChange={handleStopPositionChange}
            aria-label={t("panels:gradient.stopPosition")}
            step={1}
            min={POSITION_MIN}
            max={POSITION_MAX}
            suffix="%"
          />

          <button
            class="sigil-gradient-controls__remove-btn"
            type="button"
            aria-label={t("panels:gradient.removeStop")}
            disabled={stopsWithIds().length <= MIN_GRADIENT_STOPS}
            onClick={() => {
              const id = selectedStopId();
              if (id) handleRemoveStop(id);
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </Show>

      {/* Linear-specific: angle + reverse */}
      <Show when={props.fill.type === "linear_gradient"}>
        <div class="sigil-gradient-controls__type-row">
          <NumberInput
            value={currentAngle()}
            onValueChange={handleAngleChange}
            aria-label={t("panels:gradient.angle")}
            step={1}
            min={ANGLE_MIN}
            max={ANGLE_MAX}
            suffix="\u00B0"
          />
          <button
            class="sigil-gradient-controls__reverse-btn"
            type="button"
            aria-label={t("panels:gradient.reverse")}
            onClick={handleReverse}
          >
            {t("panels:gradient.reverse")}
          </button>
        </div>
      </Show>

      {/* Radial-specific: center X/Y + radius */}
      <Show when={props.fill.type === "radial_gradient"}>
        <div class="sigil-gradient-controls__type-row">
          <NumberInput
            value={Math.round(
              (props.fill.type === "radial_gradient" ? props.fill.gradient.start.x : 0.5) * 100,
            )}
            onValueChange={handleCenterXChange}
            aria-label={t("panels:gradient.centerX")}
            prefix="X"
            step={1}
            min={CENTER_MIN}
            max={CENTER_MAX}
            suffix="%"
          />
          <NumberInput
            value={Math.round(
              (props.fill.type === "radial_gradient" ? props.fill.gradient.start.y : 0.5) * 100,
            )}
            onValueChange={handleCenterYChange}
            aria-label={t("panels:gradient.centerY")}
            prefix="Y"
            step={1}
            min={CENTER_MIN}
            max={CENTER_MAX}
            suffix="%"
          />
          <NumberInput
            value={currentRadius()}
            onValueChange={handleRadiusChange}
            aria-label={t("panels:gradient.radius")}
            step={1}
            min={RADIUS_MIN}
            max={RADIUS_MAX}
            suffix="%"
          />
        </div>
      </Show>

      {/* Conic-specific: start angle + reverse */}
      <Show when={props.fill.type === "conic_gradient"}>
        <div class="sigil-gradient-controls__type-row">
          <NumberInput
            value={currentConicAngle()}
            onValueChange={handleConicAngleChange}
            aria-label={t("panels:gradient.angle")}
            step={1}
            min={ANGLE_MIN}
            max={ANGLE_MAX}
            suffix={"\u00B0"}
          />
          <button
            class="sigil-gradient-controls__reverse-btn"
            type="button"
            aria-label={t("panels:gradient.reverse")}
            onClick={handleReverse}
          >
            {t("panels:gradient.reverse")}
          </button>
        </div>
      </Show>
    </div>
  );
}
