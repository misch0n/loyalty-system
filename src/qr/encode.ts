/**
 * QR payloads + rendering.
 *
 * Two payload kinds:
 *  - the customer card: carries ONLY the opaque token (never PII).
 *  - the registration handoff: carries the Transport joinPayload.
 */

import QRCode from 'qrcode';

/** The card QR encodes the bare token. Resolved by staff scan → getCustomerByToken. */
export function cardPayload(token: string): string {
  return token;
}

/** The registration QR encodes the transport join payload. */
export function registrationPayload(joinPayload: string): string {
  return joinPayload;
}

/** Render any text payload to a PNG data URL for an <img>. */
export function toDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, { margin: 1, width: 240 });
}
