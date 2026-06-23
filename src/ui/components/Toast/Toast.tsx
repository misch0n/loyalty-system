/**
 * Toast — transient confirmations (Ckyka "Added 2 · Maria now at 9 / 10").
 *
 * A `ToastProvider` holds the live queue and renders it into an aria-live
 * region; `useToast()` exposes `show` (and `dismiss`). Re-styled to the donor
 * `.toast` pill; the queue/auto-dismiss logic is reused from the old kit. Pure
 * presentational state — no service calls.
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
import './Toast.css';

export interface ToastOptions {
  /** Auto-dismiss after this many ms. Defaults to 3500; 0 disables. */
  duration?: number;
}

export interface ToastItem {
  id: number;
  message: ReactNode;
  duration: number;
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
      const duration = options?.duration ?? DEFAULT_DURATION;
      setItems((prev) => [...prev, { id, message, duration }]);
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
      <div role="region" aria-live="polite" aria-label="Notifications">
        {items.map((t) => (
          <div key={t.id} className="toast" role="status">
            {t.message}
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
