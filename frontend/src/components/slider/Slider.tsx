import { Slider as KobalteSlider } from "@kobalte/core/slider";

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  ariaLabel: string;
}

export function Slider(props: SliderProps) {
  return (
    <KobalteSlider
      value={[props.value]}
      onChange={(vals) => props.onChange(vals[0]!)}
      aria-label={props.ariaLabel}
    >
      <KobalteSlider.Track>
        <KobalteSlider.Fill />
        <KobalteSlider.Thumb>
          <KobalteSlider.Input />
        </KobalteSlider.Thumb>
      </KobalteSlider.Track>
    </KobalteSlider>
  );
}
