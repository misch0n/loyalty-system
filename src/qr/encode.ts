/**
 * QR payloads + rendering.
 *
 * Two payload kinds:
 *  - the customer card: carries ONLY the opaque token (never PII).
 *  - the registration handoff: carries the full page URL + peer id, so the
 *    customer's phone can open the registration route and dial back to staff.
 */

import QRCode from 'qrcode';
import { appUrl } from '../config/links';

/**
 * The card QR encodes the URL to the customer's card page (B2), e.g.
 * `…/#/status/<token>`. Staff scanning extracts the token from it. The token is
 * an opaque random string (never PII), so it's safe to carry in the URL.
 */
export function cardPayload(token: string): string {
  return appUrl(`/status/${token}`);
}

/**
 * Pull the card token out of a scanned card QR. Accepts the card-page URL
 * (`…/status/<token>`) or a bare token (older cards / pasted codes).
 */
export function tokenFromCardScan(text: string): string {
  const match = text.match(/\/status\/([^/?#]+)/);
  return (match ? decodeURIComponent(match[1]) : text).trim();
}

/**
 * The registration QR encodes the full URL the customer's phone opens: the app's
 * base URL + the HashRouter register route carrying the peer id. The phone reads
 * the id from the route and connects back to the staff peer.
 */
export function registrationPayload(joinPayload: string): string {
  const peerId = joinPayload.replace(/^peer:/, '');
  return appUrl(`/register/${encodeURIComponent(peerId)}`);
}

/** Dark module colour — brand ink, high-contrast on the cream/white QR tiles. */
const QR_DARK = '#243029';
/** Quiet-zone margin, in modules (the QR tiles add light padding around this). */
const QR_MARGIN = 2;

/**
 * Render a payload to a **dot-style** QR as an SVG data URL for an `<img>`.
 *
 * Data modules are drawn as dots; the three finder patterns stay rounded squares
 * because scanners locate the code by them. Built from the module matrix
 * (`QRCode.create`) so no extra dependency is needed. SVG scales crisply to
 * whatever width the surrounding tile sets in CSS.
 */
export function toDataUrl(payload: string): Promise<string> {
  return Promise.resolve(dotQrSvgDataUrl(payload));
}

function dotQrSvgDataUrl(payload: string): string {
  const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const data = qr.modules.data;
  const dim = size + QR_MARGIN * 2;
  const dark = (r: number, c: number) => data[r * size + c] === 1;
  // The three 7×7 finder patterns (TL, TR, BL) are drawn as rounded eyes, so
  // skip their modules when laying down dots.
  const inFinder = (r: number, c: number) =>
    (r < 7 && c < 7) || (r < 7 && c >= size - 7) || (r >= size - 7 && c < 7);

  let dots = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!dark(r, c) || inFinder(r, c)) continue;
      dots += `<circle cx="${QR_MARGIN + c + 0.5}" cy="${QR_MARGIN + r + 0.5}" r="0.45"/>`;
    }
  }

  // A finder "eye": a 1-module-thick rounded ring (7×7) + a rounded 3×3 centre.
  const eye = (r0: number, c0: number) => {
    const x = QR_MARGIN + c0;
    const y = QR_MARGIN + r0;
    return (
      `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="2" ry="2" ` +
      `fill="none" stroke="${QR_DARK}" stroke-width="1"/>` +
      `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="1" ry="1"/>`
    );
  };
  const eyes = eye(0, 0) + eye(0, size - 7) + eye(size - 7, 0);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" ` +
    `shape-rendering="geometricPrecision"><g fill="${QR_DARK}">${dots}${eyes}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
