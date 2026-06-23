/**
 * CupStamps — THE signature element (UI-SPEC §1, §3).
 *
 * A row of mini coffee-cup marks that fill as the customer collects: outline →
 * sage-filled. The tenth completes the reward. Rendered via `data-total` /
 * `data-filled` so screens (and tests) can target state, with an accessible
 * label like "7 of 10".
 *
 * Pure presentation: pass `filled` and (optionally) `total`. Spend the boldness
 * here; everything else in the kit stays quiet.
 */

export interface CupStampsProps {
  /** How many cups are filled. Clamped to [0, total]. */
  filled: number;
  /** Total cups; the spec's reward threshold. Defaults to 10. */
  total?: number;
  className?: string;
}

function CupGlyph({ on }: { on: boolean }) {
  // Inline SVG cup mark. `on` swaps outline for a sage fill via CSS.
  return (
    <svg className="kit-cup__svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {/* steam */}
      <path
        className="kit-cup__steam"
        d="M9 3.5c0 1-1 1.4-1 2.4M12 3c0 1-1 1.4-1 2.4M15 3.5c0 1-1 1.4-1 2.4"
        fill="none"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      {/* cup body */}
      <path
        className="kit-cup__body"
        d="M5 9h12v4a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5V9Z"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill={on ? 'currentColor' : 'none'}
      />
      {/* handle */}
      <path
        className="kit-cup__handle"
        d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17"
        fill="none"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CupStamps({ filled, total = 10, className }: CupStampsProps) {
  const safeTotal = Math.max(1, Math.floor(total));
  const safeFilled = Math.min(safeTotal, Math.max(0, Math.floor(filled)));
  const cups = Array.from({ length: safeTotal }, (_, i) => i < safeFilled);
  const cls = ['kit-cups', className].filter(Boolean).join(' ');

  return (
    <div
      className={cls}
      data-total={safeTotal}
      data-filled={safeFilled}
      role="img"
      aria-label={`${safeFilled} of ${safeTotal}`}
    >
      {cups.map((on, i) => (
        <span
          key={i}
          className={`kit-cup ${on ? 'kit-cup--on' : 'kit-cup--off'}`}
          data-on={on ? 'true' : 'false'}
        >
          <CupGlyph on={on} />
        </span>
      ))}
    </div>
  );
}
