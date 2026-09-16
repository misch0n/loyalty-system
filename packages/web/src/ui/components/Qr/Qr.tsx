import { useEffect, useState, type KeyboardEvent } from 'react';
import { cardPayload, toDataUrl } from '../../../qr/encode';
import './Qr.css';

export interface QrProps {
  /** The opaque card token. Encoded into the card-page URL (never PII). */
  token: string;
  /** The short human-readable code shown under the QR, e.g. "CKY · 5YUrTHtx". */
  code: string;
  /** When provided, the tile becomes an enlarge trigger (click / Enter / Space). */
  onEnlarge?: () => void;
}

/**
 * The card QR tile (`.qrwrap`) — a compact cream box sized to fit the QR with a
 * small offset on all sides, centred on the card. No "tap to enlarge" label here
 * (that hint lives below the card); just the QR and the short card code. Renders
 * a real QR of the card URL via `toDataUrl(cardPayload(token))`; if rendering
 * fails (e.g. no canvas in tests) the `<img>` is simply left empty.
 */
export function Qr({ token, code, onEnlarge }: QrProps) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    let active = true;
    toDataUrl(cardPayload(token))
      .then((url) => {
        if (active) setSrc(url);
      })
      .catch(() => {
        if (active) setSrc('');
      });
    return () => {
      active = false;
    };
  }, [token]);

  const interactive = Boolean(onEnlarge);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onEnlarge) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onEnlarge();
    }
  };

  return (
    <div
      className={interactive ? 'qrwrap qr-trigger' : 'qrwrap'}
      onClick={onEnlarge}
      onKeyDown={interactive ? onKeyDown : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? 'Card code — tap to enlarge' : undefined}
    >
      <img className="qr" src={src} alt="Card QR code" />
      <div className="qr-code">{code}</div>
    </div>
  );
}
