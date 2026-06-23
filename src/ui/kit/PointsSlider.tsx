/**
 * PointsSlider — staff-only multi-add control (UI-SPEC §3, §4.9).
 *
 * Range 1..max (max is the program's capped multi-add). Large value readout in
 * Fraunces, tick marks beneath. Controlled: exposes `value` + `onChange`. The
 * consumer derives the button label ("Add 2 coffees") from the value.
 */

export interface PointsSliderProps {
  value: number;
  onChange: (value: number) => void;
  /** Upper bound (program multi-add cap). Range is 1..max. Defaults to 3. */
  max?: number;
  /** Disable interaction. */
  disabled?: boolean;
  /** Accessible label for the slider. */
  label?: string;
  className?: string;
}

export function PointsSlider({
  value,
  onChange,
  max = 3,
  disabled = false,
  label = 'Coffees to add',
  className,
}: PointsSliderProps) {
  const safeMax = Math.max(1, Math.floor(max));
  const safeValue = Math.min(safeMax, Math.max(1, Math.floor(value)));
  const ticks = Array.from({ length: safeMax }, (_, i) => i + 1);
  const cls = ['kit-slider', disabled ? 'kit-slider--disabled' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} data-value={safeValue} data-max={safeMax}>
      <div className="kit-slider__readout" aria-hidden="true">
        {safeValue}
      </div>
      <input
        className="kit-slider__input"
        type="range"
        min={1}
        max={safeMax}
        step={1}
        value={safeValue}
        disabled={disabled}
        aria-label={label}
        aria-valuemin={1}
        aria-valuemax={safeMax}
        aria-valuenow={safeValue}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="kit-slider__ticks" aria-hidden="true">
        {ticks.map((t) => (
          <span
            key={t}
            className={`kit-slider__tick ${t <= safeValue ? 'kit-slider__tick--on' : ''}`}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
