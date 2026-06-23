/**
 * PointsSlider — staff "coffees to add" assigner (Ckyka view 10).
 *
 * Donor `.assign` block: an `.ahead` header (`.al` label + big `.aval` value)
 * over an `<input type=range>` whose fill is driven by a `--p` percentage on its
 * style, and a `.ticks` row from min..max. Controlled — `value` + `onChange`;
 * the consumer derives the button label from the value. Pure presentation.
 */
import type { CSSProperties } from 'react';
import './Slider.css';

export interface PointsSliderProps {
  value: number;
  onChange: (value: number) => void;
  /** Upper bound (program multi-add cap). Defaults to 3. */
  max?: number;
  /** Lower bound. Defaults to 1. */
  min?: number;
  /** Label rendered in `.al`. Defaults to "Coffees to add". */
  label?: string;
}

export function PointsSlider({
  value,
  onChange,
  max = 3,
  min = 1,
  label = 'Coffees to add',
}: PointsSliderProps) {
  const safeMin = Math.floor(min);
  const safeMax = Math.max(safeMin, Math.floor(max));
  const safeValue = Math.min(safeMax, Math.max(safeMin, Math.floor(value)));
  const span = safeMax - safeMin;
  const pct = span === 0 ? 0 : ((safeValue - safeMin) / span) * 100;
  const ticks = Array.from({ length: safeMax - safeMin + 1 }, (_, i) => safeMin + i);

  const style = { '--p': `${pct}%` } as CSSProperties;

  return (
    <div className="assign">
      <div className="ahead">
        <span className="al">{label}</span>
        <span className="aval">{safeValue}</span>
      </div>
      <input
        type="range"
        min={safeMin}
        max={safeMax}
        step={1}
        value={safeValue}
        style={style}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="ticks" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
    </div>
  );
}
