/**
 * Prototype wallet passes (walletwallet.dev) — predetermined card ↔ pass mapping.
 *
 * The wallet passes are PRE-GENERATED with baked-in QR barcodes, so a pass only
 * resolves to a real card when that card's token is known up front. The first
 * THREE cards created on a device therefore get fixed preset tokens, each mapped
 * by index to one generated pass serial. Cards beyond the three reuse one of the
 * three passes (stable per token) — the button still renders, but the pass won't
 * resolve to that card. Prototype-only: real pass provisioning is a backend job.
 */

export type WalletKind = 'apple' | 'google';

/** Fixed tokens for the first three cards (valid 22-char base64url). */
export const PRESET_CARD_TOKENS: readonly string[] = [
  'PROTOcard0000000000001',
  'PROTOcard0000000000002',
  'PROTOcard0000000000003',
];

/** walletwallet pass serials, aligned by index with PRESET_CARD_TOKENS. */
export const PASS_SERIALS: readonly string[] = [
  '3ef985a7-8ee1-4dce-ac50-d6df5f01b755',
  '954e7119-f46a-442e-b038-40ec86c28b38',
  'dfd1190f-9031-47b9-8ebd-a9d88becb3e4',
];

const WALLET_API = 'https://api.walletwallet.dev';

/** Stable per-token serial: exact for the three presets, rotated for the rest. */
export function passSerialForToken(token: string): string {
  const i = PRESET_CARD_TOKENS.indexOf(token);
  if (i >= 0) return PASS_SERIALS[i];
  // Display-only rotation for cards beyond the three preconfigured ones.
  let h = 0;
  for (let k = 0; k < token.length; k += 1) h = (h * 31 + token.charCodeAt(k)) >>> 0;
  return PASS_SERIALS[h % PASS_SERIALS.length];
}

/** The walletwallet download URL for a card's pass in the given wallet. */
export function walletPassUrl(kind: WalletKind, token: string): string {
  const serial = passSerialForToken(token);
  return kind === 'apple'
    ? `${WALLET_API}/p/${serial}/apple.pkpass`
    : `${WALLET_API}/api/passes/${serial}/google`;
}

/** Which wallet to offer based on the device OS (iOS → Apple, else Google). */
export function detectWalletKind(): WalletKind {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const ua = nav?.userAgent ?? '';
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS reports as MacIntel but has touch points.
    (nav?.platform === 'MacIntel' && (nav?.maxTouchPoints ?? 0) > 1);
  return iOS ? 'apple' : 'google';
}
