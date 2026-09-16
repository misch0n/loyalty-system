/**
 * Sheet — bottom-sheet primitive (Ckyka card "⋯" menu).
 *
 * Slides up from the bottom over a dimmed scrim. Grab-handle affordance,
 * tap-scrim-to-close, Escape-to-close, and a light focus trap. The sheet is
 * also **drag-dismissable**: pressing the grab handle (the top of the sheet)
 * and dragging down slides it away; released past a threshold it closes, else it
 * snaps back. Tall content scrolls inside the sheet rather than being clipped.
 * Pure presentation; `onClose` is supplied by the screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEventHandler, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
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

/** Drag distance (px) past which releasing dismisses the sheet. */
const DISMISS_AFTER = 110;

export function Sheet({ open, onClose, children, label }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Drag-to-dismiss: how far the sheet is currently pulled down, and whether a
  // drag is in progress (used to disable the snap-back transition mid-drag).
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const startYRef = useRef(0);

  // Keep the latest onClose without it being an effect dependency — otherwise the
  // open/focus effect re-runs on every parent render (inline onClose changes
  // identity) and steals focus back to the first field on each keystroke.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    // Reset the drag offset whenever the sheet (re)opens.
    setDragY(0);
    setDragging(false);
    // Lock the background so only the sheet scrolls while it's open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
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
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
    // Only re-run when open toggles — NOT on every onClose identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onDragStart = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    startYRef.current = e.clientY;
    draggingRef.current = true;
    setDragging(true);
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // pointer capture is a progressive enhancement; ignore if unsupported
    }
  }, []);

  const onDragMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const dy = e.clientY - startYRef.current;
    setDragY(dy > 0 ? dy : 0); // only downward drags move the sheet
  }, []);

  const onDragEnd = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    setDragY((current) => {
      if (current > DISMISS_AFTER) {
        onClose();
        return current;
      }
      return 0; // snap back
    });
  }, [onClose]);

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
        style={{
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: dragging ? 'none' : undefined,
        }}
      >
        <div
          className="sheet-drag"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <div className="grab" aria-hidden="true" />
        </div>
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
      <span className="mrt">
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
