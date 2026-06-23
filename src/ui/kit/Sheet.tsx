/**
 * Sheet — bottom-sheet primitive (UI-SPEC §4.6: the card "⋯" menu).
 *
 * Slides up from the bottom over a dimmed scrim. Drag-handle affordance,
 * optional title, tap-scrim-to-close, Escape-to-close, and a light focus trap.
 * Pure presentation; `onClose` is supplied by the screen.
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Optional title rendered at the top of the sheet. */
  title?: ReactNode;
  className?: string;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

export function Sheet({ open, onClose, children, title, className }: SheetProps) {
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
  const cls = ['kit-sheet', className].filter(Boolean).join(' ');

  return (
    <div className="kit-sheet__scrim" onClick={onClose}>
      <div
        ref={panelRef}
        className={cls}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="kit-sheet__handle" aria-hidden="true" />
        {title != null && <h2 className="kit-sheet__title">{title}</h2>}
        <div className="kit-sheet__body">{children}</div>
      </div>
    </div>
  );
}
