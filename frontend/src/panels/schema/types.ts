/** Field editor types supported by the SchemaPanel renderer. */
export type FieldType = "number" | "slider" | "select" | "toggle" | "text" | "color" | "list";

/** A single editable field definition. */
export interface FieldDef {
  /** Dot-path into the node object (e.g., "transform.x", "style.opacity"). */
  readonly key: string;
  /** Display label. */
  readonly label: string;
  /** Field editor type. */
  readonly type: FieldType;
  /** Layout hint — grid columns this field spans. Default: 1. */
  readonly span?: 1 | 2;
  /** Minimum value (number/slider). */
  readonly min?: number;
  /** Maximum value (number/slider). */
  readonly max?: number;
  /** Step increment (number/slider). */
  readonly step?: number;
  /** Unit suffix displayed after the value (e.g., "deg", "px", "%"). */
  readonly suffix?: string;
  /** Options for select fields. */
  readonly options?: ReadonlyArray<{
    readonly value: string;
    readonly label: string;
  }>;
}

/** A labeled group of fields within a panel. */
export interface SectionDef {
  /** Section heading (e.g., "Transform", "Fill"). */
  readonly name: string;
  /**
   * Only show this section for specific node kinds.
   * Omit to always show. Use the `type` discriminant from NodeKind.
   */
  readonly when?: string | readonly string[];
  /** Field definitions for this section. */
  readonly fields: readonly FieldDef[];
  /** Whether the section starts collapsed. Default: false. */
  readonly collapsed?: boolean;
  /** When set to "list", the section renders as a repeatable list of items. */
  readonly type?: "list";
  /** Dot-path key for the list data source (used when type is "list"). */
  readonly key?: string;
  /** Schema for each item in the list (used when type is "list"). */
  readonly itemSchema?: readonly FieldDef[];
}

/** A complete property schema for a panel. */
export interface PropertySchema {
  readonly sections: readonly SectionDef[];
}

/**
 * Returns the string node kind type (e.g., "frame", "rectangle").
 * Used by `when` guards on sections.
 */
export type NodeKindType = string;
