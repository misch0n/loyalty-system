/**
 * PairDevices (/pair) — the "scan a till to join" screen.
 *
 * This device pairs as a CUSTOMER by scanning a till's pairing QR (the till shows
 * its QR from the prototype menu). A scanned URL carrying `?host=` auto-joins. On
 * success the provider routes to the customer home. Prototype-only.
 */

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePairing } from './PairingContext';
import { QrScanner } from './QrScanner';
import { turnConfigured } from '../../config/env';

/** Accept either a bare peer id or a full pairing URL carrying `?host=`. */
function hostIdFrom(text: string): string {
  const match = text.match(/[?&]host=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : text.trim();
}

export function PairDevices() {
  const { joined, connecting, error, joinAs } = usePairing();
  const [params] = useSearchParams();
  const hostParam = params.get('host');
  const started = useRef(false);

  // A scanned URL (native camera) carries the host id → auto-join once.
  useEffect(() => {
    if (hostParam && !started.current) {
      started.current = true;
      void joinAs(hostIdFrom(hostParam));
    }
  }, [hostParam, joinAs]);

  const turnWarning = !turnConfigured ? (
    <p className="warn">
      Relay (TURN) isn’t configured in this build, so pairing only works when both devices are on
      the <strong>same network</strong>. For different networks (e.g. one on cellular), set TURN
      credentials and redeploy.
    </p>
  ) : null;

  return (
    <div className="card">
      <h1>Scan the till</h1>
      <p className="muted">
        Point your camera at the till’s pairing code to pair as a customer. While paired, your
        points update the moment staff add them.
      </p>
      {turnWarning}
      {error && <p className="error">{error}</p>}
      {connecting || joined ? (
        <p className="status waiting">Connecting to the till…</p>
      ) : (
        <QrScanner onResult={(text) => joinAs(hostIdFrom(text))} allowManual={false} />
      )}
    </div>
  );
}
