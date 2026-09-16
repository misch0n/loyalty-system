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

/** A small star "sticker" overlaid on the welcome and reward cups. */
function StickerSeal() {
  return (
    <svg className="sticker-seal" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l2.4 6.3L21 9l-5 4.2L17.6 20 12 16.4 6.4 20 8 13.2 3 9l6.6-.7z" />
    </svg>
  );
}

export interface CupStampsProps {
  /** How many stamps are earned. Clamped to 0..total. */
  filled: number;
  /** Total stamps in the grid (the reward threshold). */
  total: number;
  /**
   * Card "showcase" layout: render `total + 1` cups — `total` earnable cups
   * followed by the FREE reward cup (last, lit as the prize). Keeps the
   * displayed grid at 10: the customer fills `total` (e.g. 9) cups and the
   * tenth coffee is free. There is no "on the house" welcome cup.
   */
  showcase?: boolean;
}

/**
 * The cup-stamp grid (`.stamps`). Default: renders `total` `.stamp` cells; the
 * first `filled` get `.on`. In `showcase` mode it renders the loyalty-card
 * layout (earnable cups + the free reward cup).
 */
export function CupStamps({ filled, total, showcase = false }: CupStampsProps) {
  const safeTotal = Math.max(0, Math.floor(total));
  const safeFilled = Math.min(safeTotal, Math.max(0, Math.floor(filled)));

  if (showcase) {
    // Fixed 10-stamp card: the customer fills the `total` (e.g. 9) cups with
    // purchases and the last (free) cup is the prize, shown pre-stamped. No
    // welcome cup — the first stamp is earned, not on the house.
    const displayTotal = safeTotal + 1;
    return (
      <div className="stamps" data-total={displayTotal} data-filled={safeFilled + 1}>
        {Array.from({ length: safeTotal }, (_, i) => (
          <span key={i} className={i < safeFilled ? 'stamp on' : 'stamp'}>
            <CupGlyph />
          </span>
        ))}
        {/* Free reward cup — always stamped with a FREE sticker (the prize). */}
        <span className="stamp on free">
          <CupGlyph />
          <StickerSeal />
          <span className="free-label">FREE</span>
        </span>
      </div>
    );
  }

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
