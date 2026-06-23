/**
 * Toast — transient confirmations (UI-SPEC §3).
 *
 * "Added 2 · Maria now at 9/10". A `ToastProvider` holds the live queue and
 * renders the stack into an aria-live region; `useToast()` exposes `show`
 * (and `dismiss`). Purely presentational state — no service calls.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';

export type ToastTone = 'default' | 'success' | 'warning';

export interface ToastOptions {
  tone?: ToastTone;
  /** Auto-dismiss after this many ms. Defaults to 3500; 0 disables. */
  duration?: number;
}

export interface ToastItem extends Required<ToastOptions> {
  id: number;
  message: ReactNode;
}

export interface ToastApi {
  /** Queue a toast; returns its id so it can be dismissed early. */
  show: (message: ReactNode, options?: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION = 3500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (message: ReactNode, options?: ToastOptions): number => {
      const id = nextId.current++;
      const tone = options?.tone ?? 'default';
      const duration = options?.duration ?? DEFAULT_DURATION;
      setItems((prev) => [...prev, { id, message, tone, duration }]);
      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration);
        timers.current.set(id, timer);
      }
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="kit-toasts" role="region" aria-live="polite" aria-label="Notifications">
        {items.map((t) => (
          <div key={t.id} className={`kit-toast kit-toast--${t.tone}`} role="status">
            <span className="kit-toast__msg">{t.message}</span>
            <button
              type="button"
              className="kit-toast__close"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a <ToastProvider>');
  }
  return ctx;
}
