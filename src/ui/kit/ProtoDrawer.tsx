/**
 * ProtoDrawer — the prototype-only tools panel wrapper (UI-SPEC §3, §4.11).
 *
 * Renders children inside an unmistakably "prototype"-styled panel — a
 * utilitarian, high-visibility surface (dashed border, mono labels, warning
 * stripe) so it can never be confused with production UI. Build-flag gating
 * lives at the call site; this is just the styled shell.
 */
import type { ReactNode } from 'react';

export interface ProtoDrawerProps {
  children: ReactNode;
  /** Panel heading; defaults to "Prototype tools". */
  title?: ReactNode;
  /** Optional close affordance handler. */
  onClose?: () => void;
  className?: string;
}

export function ProtoDrawer({ children, title = 'Prototype tools', onClose, className }: ProtoDrawerProps) {
  const cls = ['kit-proto', className].filter(Boolean).join(' ');
  return (
    <section className={cls} role="region" aria-label="Prototype tools (development only)">
      <header className="kit-proto__head">
        <span className="kit-proto__badge">DEV ONLY</span>
        <span className="kit-proto__title">{title}</span>
        {onClose && (
          <button type="button" className="kit-proto__close" aria-label="Close" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </button>
        )}
      </header>
      <div className="kit-proto__body">{children}</div>
    </section>
  );
}
