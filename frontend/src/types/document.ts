/**
 * TypeScript types mirroring the Rust core crate's node/document wire format.
 *
 * These types match the JSON serialization produced by serde with
 * `#[serde(tag = "type", rename_all = "snake_case")]` and related attributes.
 *
 * Source: crates/core/src/node.rs, crates/core/src/id.rs,
 *         crates/core/src/path.rs, crates/core/src/document.rs,
 *         crates/core/src/token.rs, crates/core/src/component.rs,
 *         crates/core/src/prototype.rs,
 *         crates/server/src/routes/document.rs
 */

// ── ID Types ──────────────────────────────────────────────────────────

/**
 * Generational arena index — serialized as `{ index, generation }`.
 *
 * NOTE: generation is u64 in Rust. JS number is safe up to 2^53.
 * If generation exceeds Number.MAX_SAFE_INTEGER, consider using string serialization.
 */
export interface NodeId {
  readonly index: number;
  readonly generation: number;
}

/** Page identifier — serialized as a UUID string. */
export type PageId = string;

/** Component identifier — serialized as a UUID string. */
export type ComponentId = string;

/** Token identifier — serialized as a UUID string. */
export type TokenId = string;

// ── Geometry ──────────────────────────────────────────────────────────

/** A 2D point. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Spatial transform for a node. */
export interface Transform {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly scale_x: number;
  readonly scale_y: number;
}

// ── Style Value (literal or token reference) ──────────────────────────

export interface StyleValueLiteral<T> {
  readonly type: "literal";
  readonly value: T;
}

export interface StyleValueTokenRef {
  readonly type: "token_ref";
  readonly name: string;
}

export type StyleValue<T> = StyleValueLiteral<T> | StyleValueTokenRef;

// ── Color ─────────────────────────────────────────────────────────────

export interface ColorSrgb {
  readonly space: "srgb";
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface ColorDisplayP3 {
  readonly space: "display_p3";
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface ColorOklch {
  readonly space: "oklch";
  readonly l: number;
  readonly c: number;
  readonly h: number;
  readonly a: number;
}

export interface ColorOklab {
  readonly space: "oklab";
  readonly l: number;
  readonly a: number;
  readonly b: number;
  readonly alpha: number;
}

export type Color = ColorSrgb | ColorDisplayP3 | ColorOklch | ColorOklab;

// ── Gradient ──────────────────────────────────────────────────────────

export interface GradientStop {
  readonly id?: string; // Frontend-only stable identity for selection/dispatch
  readonly position: number;
  readonly color: StyleValue<Color>;
}

export interface GradientDef {
  readonly stops: readonly GradientStop[];
  readonly start: Point;
  readonly end: Point;
  /** Whether the gradient repeats. Defaults to false (matches Rust #[serde(default)]). */
  readonly repeating?: boolean;
}

export interface ConicGradientDef {
  readonly center: Point;
  readonly start_angle: number;
  readonly stops: readonly GradientStop[];
  /** Whether the gradient repeats. Defaults to false (matches Rust #[serde(default)]). */
  readonly repeating?: boolean;
}

// ── Scale Mode ────────────────────────────────────────────────────────

export type ScaleMode = "fill" | "fit" | "tile" | "stretch";

// ── Fill ──────────────────────────────────────────────────────────────

export interface FillSolid {
  readonly type: "solid";
  readonly color: StyleValue<Color>;
}

export interface FillLinearGradient {
  readonly type: "linear_gradient";
  readonly gradient: GradientDef;
}

export interface FillRadialGradient {
  readonly type: "radial_gradient";
  readonly gradient: GradientDef;
}

export interface FillConicGradient {
  readonly type: "conic_gradient";
  readonly gradient: ConicGradientDef;
}

export interface FillImage {
  readonly type: "image";
  readonly asset_ref: string;
  readonly scale_mode: ScaleMode;
}

export type Fill =
  | FillSolid
  | FillLinearGradient
  | FillRadialGradient
  | FillConicGradient
  | FillImage;

// ── Stroke ────────────────────────────────────────────────────────────

export type StrokeAlignment = "inside" | "outside" | "center";
export type StrokeCap = "butt" | "round" | "square";
export type StrokeJoin = "miter" | "round" | "bevel";

export interface Stroke {
  readonly color: StyleValue<Color>;
  readonly width: StyleValue<number>;
  readonly alignment: StrokeAlignment;
  readonly cap: StrokeCap;
  readonly join: StrokeJoin;
}

// ── Effect ────────────────────────────────────────────────────────────

export interface EffectDropShadow {
  readonly type: "drop_shadow";
  readonly color: StyleValue<Color>;
  readonly offset: Point;
  readonly blur: StyleValue<number>;
  readonly spread: StyleValue<number>;
}

export interface EffectInnerShadow {
  readonly type: "inner_shadow";
  readonly color: StyleValue<Color>;
  readonly offset: Point;
  readonly blur: StyleValue<number>;
  readonly spread: StyleValue<number>;
}

export interface EffectLayerBlur {
  readonly type: "layer_blur";
  readonly radius: StyleValue<number>;
}

export interface EffectBackgroundBlur {
  readonly type: "background_blur";
  readonly radius: StyleValue<number>;
}

export type Effect = EffectDropShadow | EffectInnerShadow | EffectLayerBlur | EffectBackgroundBlur;

// ── Blend Mode ────────────────────────────────────────────────────────

export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color_dodge"
  | "color_burn"
  | "hard_light"
  | "soft_light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

// ── Style ─────────────────────────────────────────────────────────────

export interface Style {
  readonly fills: readonly Fill[];
  readonly strokes: readonly Stroke[];
  readonly opacity: StyleValue<number>;
  readonly blend_mode: BlendMode;
  readonly effects: readonly Effect[];
}

// ── Constraints ───────────────────────────────────────────────────────

export type PinConstraint = "start" | "end" | "start_and_end" | "center" | "scale";

export interface Constraints {
  readonly horizontal: PinConstraint;
  readonly vertical: PinConstraint;
}

// ── Layout ────────────────────────────────────────────────────────────

export type LayoutDirection = "row" | "column";
export type AlignItems = "start" | "center" | "end" | "stretch";
export type JustifyContent =
  | "start"
  | "center"
  | "end"
  | "space_between"
  | "space_around"
  | "space_evenly";
export type JustifyItems = "start" | "center" | "end" | "stretch";

export interface Padding {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface FlexLayout {
  readonly mode: "flex";
  readonly direction: LayoutDirection;
  readonly gap: number;
  readonly padding: Padding;
  readonly align_items: AlignItems;
  readonly justify_content: JustifyContent;
  readonly wrap: boolean;
}

export interface GridTrackFixed {
  readonly type: "fixed";
  readonly size: number;
}

export interface GridTrackFractional {
  readonly type: "fractional";
  readonly fraction: number;
}

export interface GridTrackAuto {
  readonly type: "auto";
}

export interface GridTrackMinMax {
  readonly type: "min_max";
  readonly min: number;
  readonly max: number;
}

export type GridTrack = GridTrackFixed | GridTrackFractional | GridTrackAuto | GridTrackMinMax;

export interface GridLayout {
  readonly mode: "grid";
  readonly columns: readonly GridTrack[];
  readonly rows: readonly GridTrack[];
  readonly column_gap: number;
  readonly row_gap: number;
  readonly padding: Padding;
  readonly align_items: AlignItems;
  readonly justify_items: JustifyItems;
}

export type LayoutMode = FlexLayout | GridLayout;

// ── Grid Placement ────────────────────────────────────────────────────

export interface GridSpanAuto {
  readonly type: "auto";
}

export interface GridSpanLine {
  readonly type: "line";
  readonly index: number;
}

export interface GridSpanSpan {
  readonly type: "span";
  readonly count: number;
}

export interface GridSpanLineToLine {
  readonly type: "line_to_line";
  readonly start: number;
  readonly end: number;
}

export type GridSpan = GridSpanAuto | GridSpanLine | GridSpanSpan | GridSpanLineToLine;

export interface GridPlacement {
  readonly column: GridSpan;
  readonly row: GridSpan;
}

// ── Text ──────────────────────────────────────────────────────────────

export type TextAlign = "left" | "center" | "right" | "justify";
export type FontStyle = "normal" | "italic";
export type TextDecoration = "none" | "underline" | "strikethrough";
export type TextSizing = "auto_width" | "fixed_width";

export interface TextShadow {
  readonly offset_x: number;
  readonly offset_y: number;
  readonly blur_radius: number;
  readonly color: StyleValue<Color>;
}

export interface TextStyle {
  readonly font_family: string;
  readonly font_size: StyleValue<number>;
  readonly font_weight: number;
  readonly font_style: FontStyle;
  readonly line_height: StyleValue<number>;
  readonly letter_spacing: StyleValue<number>;
  readonly text_align: TextAlign;
  readonly text_decoration: TextDecoration;
  readonly text_color: StyleValue<Color>;
  readonly text_shadow?: TextShadow | null;
}

// ── Path ──────────────────────────────────────────────────────────────

export interface PathSegmentMoveTo {
  readonly type: "move_to";
  readonly point: Point;
}

export interface PathSegmentLineTo {
  readonly type: "line_to";
  readonly point: Point;
}

export interface PathSegmentCubicTo {
  readonly type: "cubic_to";
  readonly control1: Point;
  readonly control2: Point;
  readonly end: Point;
}

export interface PathSegmentClose {
  readonly type: "close";
}

export type PathSegment =
  | PathSegmentMoveTo
  | PathSegmentLineTo
  | PathSegmentCubicTo
  | PathSegmentClose;

export interface SubPath {
  readonly segments: readonly PathSegment[];
  readonly closed: boolean;
}

export type FillRule = "even_odd" | "non_zero";

export interface PathData {
  readonly subpaths: readonly SubPath[];
  readonly fill_rule: FillRule;
}

// ── Component Override Types ──────────────────────────────────────────

export type PropertyPath =
  | { readonly type: "name" }
  | { readonly type: "transform_x" }
  | { readonly type: "transform_y" }
  | { readonly type: "width" }
  | { readonly type: "height" }
  | { readonly type: "rotation" }
  | { readonly type: "scale_x" }
  | { readonly type: "scale_y" }
  | { readonly type: "fill"; readonly index: number }
  | { readonly type: "stroke"; readonly index: number }
  | { readonly type: "opacity" }
  | { readonly type: "blend_mode" }
  | { readonly type: "effect"; readonly index: number }
  | { readonly type: "text_content" }
  | { readonly type: "visible" }
  | { readonly type: "locked" }
  | { readonly type: "constraints" }
  | { readonly type: "transform" };

export type OverrideValue =
  | { readonly type: "string"; readonly value: string }
  | { readonly type: "number"; readonly value: number }
  | { readonly type: "bool"; readonly value: boolean }
  | { readonly type: "fill"; readonly value: Fill }
  | { readonly type: "stroke"; readonly value: Stroke }
  | { readonly type: "opacity"; readonly value: StyleValue<number> }
  | { readonly type: "blend_mode"; readonly value: BlendMode }
  | { readonly type: "effect"; readonly value: Effect }
  | { readonly type: "constraints"; readonly value: Constraints }
  | { readonly type: "transform"; readonly value: Transform };

export type OverrideSource = "variant" | "user";

export interface OverrideKey {
  readonly node_uuid: string;
  readonly path: PropertyPath;
}

/**
 * Serialized override map: array of `{ key, value, source }` entries.
 * The Rust `OverrideMap` uses a custom serializer that emits a sorted array.
 */
export interface OverrideMapEntry {
  readonly key: OverrideKey;
  readonly value: OverrideValue;
  readonly source: OverrideSource;
}

export type OverrideMap = readonly OverrideMapEntry[];

// ── Component ─────────────────────────────────────────────────────────

export type ComponentPropertyType = "text" | "boolean" | "instance_swap" | "variant";

export interface ComponentProperty {
  readonly name: string;
  readonly property_type: ComponentPropertyType;
  readonly default_value: OverrideValue;
}

export interface Variant {
  readonly name: string;
  readonly overrides: OverrideMap;
}

export interface ComponentDef {
  readonly id: ComponentId;
  readonly name: string;
  readonly root_node: NodeId;
  readonly variants: readonly Variant[];
  readonly properties: readonly ComponentProperty[];
}

// ── Token Types ───────────────────────────────────────────────────────

export type DimensionUnit = "px" | "rem" | "em" | "percent";

export interface ShadowValue {
  readonly color: Color;
  readonly offset: Point;
  readonly blur: number;
  readonly spread: number;
}

export interface TypographyValue {
  readonly font_family: string;
  readonly font_size: number;
  readonly font_weight: number;
  readonly line_height: number;
  readonly letter_spacing: number;
}

export type TokenType =
  | "color"
  | "dimension"
  | "font_family"
  | "font_weight"
  | "duration"
  | "cubic_bezier"
  | "number"
  | "shadow"
  | "gradient"
  | "typography";

export type TokenValue =
  | { readonly type: "color"; readonly value: Color }
  | { readonly type: "dimension"; readonly value: number; readonly unit: DimensionUnit }
  | { readonly type: "font_family"; readonly families: readonly string[] }
  | { readonly type: "font_weight"; readonly weight: number }
  | { readonly type: "duration"; readonly seconds: number }
  | {
      readonly type: "cubic_bezier";
      readonly values: readonly [number, number, number, number];
    }
  | { readonly type: "number"; readonly value: number }
  | { readonly type: "shadow"; readonly value: ShadowValue }
  | { readonly type: "gradient"; readonly gradient: GradientDef }
  | { readonly type: "typography"; readonly value: TypographyValue }
  | { readonly type: "alias"; readonly name: string };

export interface Token {
  readonly id: TokenId;
  readonly name: string;
  readonly value: TokenValue;
  readonly token_type: TokenType;
  readonly description: string | null;
}

// ── Prototype / Transition ────────────────────────────────────────────

export type SlideDirection = "left" | "right" | "up" | "down";

export type TransitionTrigger =
  | { readonly type: "on_click" }
  | { readonly type: "on_drag" }
  | { readonly type: "on_hover" }
  | { readonly type: "after_delay"; readonly seconds: number };

export type TransitionAnimation =
  | { readonly type: "instant" }
  | { readonly type: "dissolve"; readonly duration: number }
  | {
      readonly type: "slide_in";
      readonly direction: SlideDirection;
      readonly duration: number;
    }
  | {
      readonly type: "slide_out";
      readonly direction: SlideDirection;
      readonly duration: number;
    }
  | {
      readonly type: "push";
      readonly direction: SlideDirection;
      readonly duration: number;
    };

export interface Transition {
  readonly id: string;
  readonly source_node: NodeId;
  readonly target_page: PageId;
  readonly target_node: NodeId | null;
  readonly trigger: TransitionTrigger;
  readonly animation: TransitionAnimation;
}

// ── NodeKind (tagged union) ───────────────────────────────────────────

export interface NodeKindFrame {
  readonly type: "frame";
  readonly layout: LayoutMode | null;
}

export interface NodeKindRectangle {
  readonly type: "rectangle";
  readonly corner_radii: readonly [number, number, number, number];
}

export interface NodeKindEllipse {
  readonly type: "ellipse";
  readonly arc_start: number;
  readonly arc_end: number;
}

export interface NodeKindPath {
  readonly type: "path";
  readonly path_data: PathData;
}

export interface NodeKindText {
  readonly type: "text";
  readonly content: string;
  readonly text_style: TextStyle;
  readonly sizing: TextSizing;
}

export interface NodeKindImage {
  readonly type: "image";
  readonly asset_ref: string;
}

export interface NodeKindGroup {
  readonly type: "group";
}

export interface NodeKindComponentInstance {
  readonly type: "component_instance";
  readonly component_id: ComponentId;
  readonly variant: string | null;
  readonly overrides: OverrideMap;
  readonly property_values: Record<string, OverrideValue>;
}

export type NodeKind =
  | NodeKindFrame
  | NodeKindRectangle
  | NodeKindEllipse
  | NodeKindPath
  | NodeKindText
  | NodeKindImage
  | NodeKindGroup
  | NodeKindComponentInstance;

// ── DocumentNode ──────────────────────────────────────────────────────

/** A node in the design document (mirrors `crates/core/src/node.rs::Node`). */
export interface DocumentNode {
  readonly id: NodeId;
  readonly uuid: string;
  readonly kind: NodeKind;
  readonly name: string;
  readonly parent: NodeId | null;
  readonly children: readonly NodeId[];
  readonly transform: Transform;
  readonly style: Style;
  readonly constraints: Constraints;
  readonly grid_placement: GridPlacement | null;
  readonly visible: boolean;
  readonly locked: boolean;
}

// ── Page ──────────────────────────────────────────────────────────────

/** A page within the document. */
export interface Page {
  readonly id: PageId;
  readonly name: string;
  readonly root_nodes: readonly NodeId[];
}

// ── DocumentInfo ──────────────────────────────────────────────────────

/** Response from `GET /api/document` (mirrors `crates/server/src/routes/document.rs`). */
export interface DocumentInfo {
  readonly name: string;
  readonly page_count: number;
  readonly node_count: number;
  readonly can_undo: boolean;
  readonly can_redo: boolean;
}
