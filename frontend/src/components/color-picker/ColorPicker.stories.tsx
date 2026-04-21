/**
 * ColorPicker.stories.tsx — Storybook stories for the ColorPicker and
 * its sub-widgets (ColorArea, HueStrip, AlphaStrip, ColorSpaceSwitcher).
 *
 * Each story wraps interactive state with createSignal so the components
 * behave like they would in a real application.
 */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import type { Color } from "../../types/document";
import { colorToHex } from "./color-math";
import { ColorSwatch } from "./ColorSwatch";
import { ColorPicker } from "./ColorPicker";
import { ColorArea } from "./ColorArea";
import { HueStrip } from "./HueStrip";
import { AlphaStrip } from "./AlphaStrip";
import { ColorSpaceSwitcher } from "./ColorSpaceSwitcher";
import { GradientEditor } from "./GradientEditor";
import type { GradientStop } from "../../types/document";
import type { ColorDisplayMode } from "./types";

// ── Story meta ──────────────────────────────────────────────────────────

const meta: Meta<typeof ColorPicker> = {
  title: "Components/ColorPicker",
  component: ColorPicker,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof ColorPicker>;

// ── FullPicker ──────────────────────────────────────────────────────────

/**
 * Full color picker popover. Click the swatch button to open it.
 * Shows the selected hex value below the trigger.
 */
export const FullPicker: Story = {
  render: () => {
    const [color, setColor] = createSignal<Color>({
      space: "srgb",
      r: 0.2,
      g: 0.5,
      b: 0.9,
      a: 1,
    });

    return (
      <div
        style={{
          background: "var(--surface-1)",
          padding: "40px",
          display: "flex",
          "flex-direction": "column",
          "align-items": "flex-start",
          gap: "12px",
          "min-height": "200px",
        }}
      >
        <ColorSwatch color={color()} onColorChange={setColor} placement="bottom" />
        <span style={{ color: "var(--text-2)", "font-size": "12px", "font-family": "monospace" }}>
          {colorToHex(color())}
        </span>
      </div>
    );
  },
};

// ── Area ────────────────────────────────────────────────────────────────

/**
 * Standalone ColorArea — a 2D saturation/lightness picker.
 * The gradient here shows a blue-to-white area.
 */
export const Area: Story = {
  render: () => {
    const [x, setX] = createSignal(0.7);
    const [y, setY] = createSignal(0.6);

    // Blue-to-white gradient + transparent-to-black overlay.
    const renderBackground = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const hGrad = ctx.createLinearGradient(0, 0, width, 0);
      hGrad.addColorStop(0, "#ffffff");
      hGrad.addColorStop(1, "#0055ff");
      ctx.fillStyle = hGrad;
      ctx.fillRect(0, 0, width, height);

      const vGrad = ctx.createLinearGradient(0, 0, 0, height);
      vGrad.addColorStop(0, "rgba(0,0,0,0)");
      vGrad.addColorStop(1, "rgba(0,0,0,1)");
      ctx.fillStyle = vGrad;
      ctx.fillRect(0, 0, width, height);
    };

    return (
      <div
        style={{
          background: "var(--surface-1)",
          padding: "20px",
          display: "inline-flex",
          "flex-direction": "column",
          gap: "8px",
        }}
      >
        <ColorArea
          xValue={x()}
          yValue={y()}
          onChange={(nx, ny) => {
            setX(nx);
            setY(ny);
          }}
          renderBackground={renderBackground}
          aria-label="Color saturation and lightness"
        />
        <span style={{ color: "var(--text-2)", "font-size": "11px" }}>
          x: {Math.round(x() * 100)}% y: {Math.round(y() * 100)}%
        </span>
      </div>
    );
  },
};

// ── Hue ─────────────────────────────────────────────────────────────────

/**
 * Standalone HueStrip — shows the current hue in degrees.
 */
export const Hue: Story = {
  render: () => {
    const [hue, setHue] = createSignal(210);

    return (
      <div
        style={{
          background: "var(--surface-1)",
          padding: "20px",
          display: "inline-flex",
          "flex-direction": "column",
          gap: "8px",
        }}
      >
        <HueStrip hue={hue()} onChange={setHue} aria-label="Hue" />
        <span style={{ color: "var(--text-2)", "font-size": "11px" }}>
          Hue: {Math.round(hue())}°
        </span>
      </div>
    );
  },
};

// ── Alpha ────────────────────────────────────────────────────────────────

/**
 * Standalone AlphaStrip — shows a blue color fading to transparent.
 * Displays current alpha as a percentage.
 */
export const Alpha: Story = {
  render: () => {
    const [alpha, setAlpha] = createSignal(0.75);

    return (
      <div
        style={{
          background: "var(--surface-1)",
          padding: "20px",
          display: "inline-flex",
          "flex-direction": "column",
          gap: "8px",
        }}
      >
        <AlphaStrip alpha={alpha()} colorCss="#3399ff" onChange={setAlpha} aria-label="Opacity" />
        <span style={{ color: "var(--text-2)", "font-size": "11px" }}>
          Opacity: {Math.round(alpha() * 100)}%
        </span>
      </div>
    );
  },
};

// ── SpaceSwitcher ────────────────────────────────────────────────────────

/**
 * Standalone ColorSpaceSwitcher — 4-option segmented toggle.
 */
export const SpaceSwitcher: Story = {
  render: () => {
    const [space, setSpace] = createSignal<ColorDisplayMode>("srgb");

    return (
      <div
        style={{
          background: "var(--surface-1)",
          padding: "20px",
          display: "inline-flex",
          "flex-direction": "column",
          gap: "8px",
          width: "270px",
        }}
      >
        <ColorSpaceSwitcher value={space()} onChange={setSpace} />
        <span style={{ color: "var(--text-2)", "font-size": "11px" }}>Selected: {space()}</span>
      </div>
    );
  },
};

// ── Gradient ──────────────────────────────────────────────────────────────

/**
 * GradientEditor — visual gradient stop editor with drag handles.
 * Drag stops to reposition, click the bar to add, drag off to remove.
 */
export const Gradient: StoryObj = {
  render: () => {
    const [stops, setStops] = createSignal<GradientStop[]>([
      {
        position: 0,
        color: { type: "literal", value: { space: "srgb", r: 1, g: 0, b: 0, a: 1 } },
      },
      {
        position: 1,
        color: { type: "literal", value: { space: "srgb", r: 0, g: 0, b: 1, a: 1 } },
      },
    ]);
    const [type, setType] = createSignal<"linear" | "radial">("linear");
    const [angle, setAngle] = createSignal(90);
    const [selected, setSelected] = createSignal(0);
    return (
      <div style={{ padding: "20px", background: "var(--surface-1)", width: "260px" }}>
        <GradientEditor
          stops={stops()}
          gradientType={type()}
          angle={angle()}
          selectedStopIndex={selected()}
          onStopsChange={(s) => setStops(s)}
          onGradientTypeChange={setType}
          onAngleChange={setAngle}
          onSelectStop={setSelected}
        />
      </div>
    );
  },
};
