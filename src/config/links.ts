/**
 * App URL builder.
 *
 * Builds absolute URLs into the HashRouter SPA (origin + Vite base + `#`-route),
 * so QR codes and emailed links resolve correctly under the GitHub Pages base
 * path. One place to get this right; callers pass a hash path like `/recover/x`.
 */

import { baseUrl } from './env';

export function appUrl(hashPath: string): string {
  const path = hashPath.startsWith('/') ? hashPath : `/${hashPath}`;
  return `${window.location.origin}${baseUrl}#${path}`;
}
