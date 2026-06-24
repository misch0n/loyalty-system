/**
 * useContinuityTheme — drives the iOS Safari toolbar tint (`<meta theme-color>`)
 * for a "continuity scroll" page.
 *
 * The active colour owns the screen while the hero is in view; once the next
 * (continued) section scrolls up into view, the tint switches to its colour. The
 * point: iOS Safari's translucent bottom bar shows whatever is behind it, so a
 * mismatched next-section colour peeks through as an ugly sliver. Tinting the bar
 * to match what's behind it removes that.
 *
 * Returns a ref to attach to the continued section so we can observe it. No-ops
 * gracefully where `IntersectionObserver` is unavailable (just holds `active`).
 */
import { useEffect, useRef } from 'react';

function metaEl(): HTMLMetaElement {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  return meta;
}

function setThemeColor(color: string): void {
  metaEl().setAttribute('content', color);
}

export function useContinuityTheme<T extends HTMLElement>(active: string, next: string) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const prev = metaEl().getAttribute('content');
    setThemeColor(active);

    const el = ref.current;
    let observer: IntersectionObserver | undefined;
    if (el && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        ([entry]) => setThemeColor(entry.isIntersecting ? next : active),
        // Flip once the continued section has scrolled ~55% up the viewport.
        { rootMargin: '0px 0px -45% 0px' },
      );
      observer.observe(el);
    }
    return () => {
      observer?.disconnect();
      // Restore whatever the tint was before this page set it.
      setThemeColor(prev ?? active);
    };
  }, [active, next]);
  return ref;
}
