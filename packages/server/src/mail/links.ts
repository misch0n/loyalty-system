/**
 * Links into the SPA, built server-side.
 *
 * The browser's `src/config/links.ts` reads `window.location.origin`; a server
 * has no such thing, and behind Cloudflare the request's own host is the
 * proxy's. So the origin comes from `APP_URL` and nothing else.
 *
 * The `#` is not decorative: the SPA uses `HashRouter` (`src/main.tsx`), so a
 * link without it lands on the web server's 404 rather than on the card.
 */

/** Absolute URL for a customer's card hub (`ROUTES.card`). */
export function cardLink(appUrl: string, token: string): string {
  return `${appUrl}/#/card/${encodeURIComponent(token)}`;
}
