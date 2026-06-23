import './CupStamps.css';

/** The mini cup glyph inside each stamp — ports `mock.js cupGlyph` to JSX. */
const CUP_LINES = Array.from({ length: 10 }, (_, i) => {
  const a = (i / 10) * Math.PI * 2;
  return {
    x1: (12 + Math.cos(a) * 3).toFixed(1),
    y1: (12 + Math.sin(a) * 3).toFixed(1),
    x2: (12 + Math.cos(a) * 6).toFixed(1),
    y2: (12 + Math.sin(a) * 6).toFixed(1),
  };
});

function CupGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx={12} cy={12} r={7} stroke="currentColor" strokeWidth={2} />
      {CUP_LINES.map((l, i) => (
        <line
          key={i}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
          stroke="currentColor"
          strokeWidth={1.1}
          strokeLinecap="round"
        />
      ))}
      <circle cx={12} cy={12} r={2} fill="currentColor" />
    </svg>
  );
}

export interface CupStampsProps {
  /** How many stamps are earned. Clamped to 0..total. */
  filled: number;
  /** Total stamps in the grid (the reward threshold). */
  total: number;
}

/**
 * The cup-stamp grid (`.stamps`). Renders `total` `.stamp` cells; the first
 * `filled` get `.on`. Mirrors the donor data-total/data-filled attributes.
 */
export function CupStamps({ filled, total }: CupStampsProps) {
  const safeTotal = Math.max(0, Math.floor(total));
  const safeFilled = Math.min(safeTotal, Math.max(0, Math.floor(filled)));
  return (
    <div className="stamps" data-total={safeTotal} data-filled={safeFilled}>
      {Array.from({ length: safeTotal }, (_, i) => (
        <span key={i} className={i < safeFilled ? 'stamp on' : 'stamp'}>
          <CupGlyph />
        </span>
      ))}
    </div>
  );
}
