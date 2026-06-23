/**
 * Overlay — full-surface modal primitive (UI-SPEC §4.5: the enlarged-QR sheet).
 *
 * Covers the whole viewport with an opaque surface (maximises scan contrast).
 * Provides a top-right close affordance, tap-scrim-to-close, Escape-to-close,
 * and a light focus trap (focus moves into the panel on open; Tab is kept
 * inside). Pure presentation — `onClose` is supplied by the screen.
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export interface OverlayProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Accessible label for the dialog. */
  label?: string;
  /** Surface tone; the enlarged QR uses 'white' for contrast. */
  tone?: 'white' | 'paper';
  /** Hide the corner close button (tap-scrim / Escape still work). */
  hideClose?: boolean;
  className?: string;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

export function Overlay({
  open,
  onClose,
  children,
  label,
  tone = 'white',
  hideClose = false,
  className,
}: OverlayProps) {
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
  const cls = ['kit-overlay', `kit-overlay--${tone}`, className].filter(Boolean).join(' ');

  return (
    <div className="kit-overlay__scrim" onClick={onClose}>
      <div
        ref={panelRef}
        className={cls}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {!hideClose && (
          <button type="button" className="kit-overlay__close" onClick={onClose} aria-label="Close">
            <span aria-hidden="true">×</span>
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
