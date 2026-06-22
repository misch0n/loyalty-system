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

/** The card QR encodes the bare token. Resolved by staff scan → getCustomerByToken. */
export function cardPayload(token: string): string {
  return token;
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

/** Render any text payload to a PNG data URL for an <img>. */
export function toDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, { margin: 1, width: 240 });
}
