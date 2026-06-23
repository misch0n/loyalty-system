/**
 * Sheet — bottom-sheet primitive (Ckyka card "⋯" menu).
 *
 * Slides up from the bottom over a dimmed scrim. Grab-handle affordance,
 * tap-scrim-to-close, Escape-to-close, and a light focus trap. Pure
 * presentation; `onClose` is supplied by the screen. Re-styled to the donor
 * `.sheet-back / .sheet / .grab` markup; focus-trap logic reused from the old kit.
 */
import { useEffect, useRef } from 'react';
import type { MouseEventHandler, ReactNode } from 'react';
import './Sheet.css';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Accessible label for the dialog. */
  label?: string;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

export function Sheet({ open, onClose, children, label }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab' && panel) {
        const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (n) => n.offsetParent !== null,
        );
        if (nodes.length === 0) {
          e.preventDefault();
          return;
        }
        const firstEl = nodes[0];
        const lastEl = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const stop: MouseEventHandler = (e) => e.stopPropagation();

  return (
    <div className="sheet-back" onClick={onClose}>
      <div
        ref={panelRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={stop}
      >
        <div className="grab" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}

export interface MenuRowProps {
  icon: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Destructive styling (blush/terra). */
  danger?: boolean;
  /** Drops the top border on the first row. */
  first?: boolean;
  onClick?: () => void;
}

export function MenuRow({ icon, title, subtitle, danger, first, onClick }: MenuRowProps) {
  const cls = ['menu-row', first ? 'first' : '', danger ? 'danger' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={cls} onClick={onClick}>
      <span className="mi">{icon}</span>
      <span>
        <span className="mt">{title}</span>
        {subtitle != null && <span className="ms">{subtitle}</span>}
      </span>
      <span className="go" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

export function RecoveryLine({ children }: { children: ReactNode }) {
  return <div className="recovery-line">{children}</div>;
}
