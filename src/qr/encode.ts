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
 * Scan source: `'a'` = app/web card camera, `'w'` = a wallet pass. Recorded on
 * the audit entry; drives nothing but validation/analytics (REWARDS-PLAN §3.5).
 */
export type ScanSource = 'a' | 'w';

/**
 * What a single staff scan resolves to (rewards-as-objects, REWARDS-PLAN §3.5).
 * A card scan carries the customer token only; a reward scan additionally
 * carries 1..N reward tokens (a single reward is just a 1-element composite).
 */
export interface ScanResult {
  kind: 'card' | 'reward';
  customerToken: string;
  /** Reward tokens to pre-attach for redemption (empty for a plain card scan). */
  rewardTokens: string[];
  source: ScanSource;
}

/**
 * Build the **card** scan URL embedded in the card/wallet QR:
 * `…/#/c/<customerToken>?s=a|w`. Staff-scan only — never a customer route.
 */
export function cardScanPayload(token: string, source: ScanSource = 'a'): string {
  return appUrl(`/c/${encodeURIComponent(token)}?s=${source}`);
}

/**
 * Build the **reward** scan URL embedded in a redeem QR:
 * `…/#/r?ids=<rewardToken[,rewardToken…]>&c=<customerToken>&s=a`. One QR can
 * carry 1..10 reward tokens (a single reward is a 1-element composite). Staff-scan
 * only — never a customer route.
 */
export function rewardScanPayload(
  rewardTokens: string[],
  customerToken: string,
  source: ScanSource = 'a',
): string {
  const ids = rewardTokens.map(encodeURIComponent).join(',');
  return appUrl(`/r?ids=${ids}&c=${encodeURIComponent(customerToken)}&s=${source}`);
}

function asSource(value: string | null): ScanSource {
  return value === 'w' ? 'w' : 'a';
}

/**
 * Parse any scanned code into a uniform {@link ScanResult} (REWARDS-PLAN §3.5).
 * Handles the two scan-URL shapes plus legacy/bare fallbacks:
 *  - `…/#/r?ids=<tok,…>&c=<token>&s=a`  → reward (1..N tokens)
 *  - `…/#/c/<token>?s=a|w`              → card (+source)
 *  - `…/#/status/<token>` or a bare token → card, source `'a'` (back-compat, so
 *    old baked wallet passes never hard-fail)
 */
export function parseScan(text: string): ScanResult {
  const raw = text.trim();
  // Everything after the hash is the in-app route; the base path is irrelevant.
  const hashIdx = raw.indexOf('#');
  const route = hashIdx >= 0 ? raw.slice(hashIdx + 1) : raw;

  // reward: /r?ids=<tok,…>&c=<customerToken>&s=a
  const reward = route.match(/\/r\?(.+)$/);
  if (reward) {
    const params = new URLSearchParams(reward[1]);
    const rewardTokens = (params.get('ids') ?? '')
      .split(',')
      .map((t) => decodeURIComponent(t).trim())
      .filter(Boolean);
    return {
      kind: 'reward',
      customerToken: decodeURIComponent(params.get('c') ?? '').trim(),
      rewardTokens,
      source: asSource(params.get('s')),
    };
  }

  // card: /c/<customerToken>?s=a|w
  const card = route.match(/\/c\/([^/?#]+)(?:\?(.*))?$/);
  if (card) {
    const params = new URLSearchParams(card[2] ?? '');
    return {
      kind: 'card',
      customerToken: decodeURIComponent(card[1]).trim(),
      rewardTokens: [],
      source: asSource(params.get('s')),
    };
  }

  // legacy /status/<token> or a bare token → plain card, app source.
  return { kind: 'card', customerToken: tokenFromCardScan(raw), rewardTokens: [], source: 'a' };
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
