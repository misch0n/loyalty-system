/**
 * ScanFrame — camera viewport wrapper (UI-SPEC §3, §4.9).
 *
 * Draws corner brackets and a sweeping scan line over a slot where the screen
 * mounts its live camera element (children). On `success` the frame collapses
 * (prop-driven) so the resolved card can take its place. Reduced-motion stops
 * the scan-line sweep (handled in theme.css). Purely presentational.
 */
import type { ReactNode } from 'react';

export interface ScanFrameProps {
  /** The live camera element / preview, mounted by the screen. */
  children?: ReactNode;
  /** Collapses the frame when true (scan resolved). */
  success?: boolean;
  /** Helper line under the frame ("Point at the customer's code."). */
  hint?: ReactNode;
  className?: string;
}

export function ScanFrame({ children, success = false, hint, className }: ScanFrameProps) {
  const cls = ['kit-scan', success ? 'kit-scan--success' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} data-success={success ? 'true' : 'false'} aria-hidden={success || undefined}>
      <div className="kit-scan__viewport">
        <div className="kit-scan__video">{children}</div>
        <span className="kit-scan__bracket kit-scan__bracket--tl" aria-hidden="true" />
        <span className="kit-scan__bracket kit-scan__bracket--tr" aria-hidden="true" />
        <span className="kit-scan__bracket kit-scan__bracket--bl" aria-hidden="true" />
        <span className="kit-scan__bracket kit-scan__bracket--br" aria-hidden="true" />
        {!success && <span className="kit-scan__line" aria-hidden="true" />}
      </div>
      {hint != null && <p className="kit-scan__hint">{hint}</p>}
    </div>
  );
}
