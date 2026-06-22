/**
 * PairDevices — the prototype pairing screen (the server stand-in).
 *
 * The device that INITIATES pairing becomes the till (host): it shows a pairing
 * QR for the other device to scan. The scanning device joins as the customer.
 * No login is needed to pair — login later decides which screens a device sees.
 * Once paired, each device is sent to its area (till → staff, customer → home),
 * and the paired host's store transparently serves the customer device.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePairing } from './PairingContext';
import { QrDisplay } from './QrDisplay';
import { QrScanner } from './QrScanner';
import { appUrl } from '../../config/links';
import { turnConfigured } from '../../config/env';

/** Accept either a bare peer id or a full pairing URL carrying `?host=`. */
function hostIdFrom(text: string): string {
  const match = text.match(/[?&]host=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : text.trim();
}

export function PairDevices() {
  const { status, role, peerId, error, startHosting, joinAs, unpair } = usePairing();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const hostParam = params.get('host');
  // Scanned a code (host param) → join; otherwise this device initiates as the till.
  const [mode, setMode] = useState<'host' | 'join'>(hostParam ? 'join' : 'host');
  const started = useRef(false);

  // Auto-start the right side exactly once.
  useEffect(() => {
    if (started.current || status !== 'idle') return;
    if (mode === 'join' && hostParam) {
      started.current = true;
      void joinAs(hostParam);
    } else if (mode === 'host') {
      started.current = true;
      void startHosting();
    }
  }, [mode, hostParam, status, joinAs, startHosting]);

  // Paired: send each device to its area — till → staff, customer → home.
  useEffect(() => {
    if (status === 'paired') {
      navigate(role === 'host' ? '/staff' : '/', { replace: true });
    }
  }, [status, role, navigate]);

  const turnWarning = !turnConfigured ? (
    <p className="warn">
      Relay (TURN) isn’t configured in this build, so pairing only works when both devices are on
      the <strong>same network</strong>. For different networks (e.g. one on cellular), set TURN
      credentials and redeploy.
    </p>
  ) : null;

  // ── Joining view (this device scans the till's code) ─────────────────────────
  if (mode === 'join') {
    return (
      <div className="card">
        <h1>Join the till</h1>
        <p className="muted">Point your camera at the pairing code on the till’s screen.</p>
        {turnWarning}
        {error && <p className="error">{error}</p>}
        {status === 'connecting' ? (
          <p className="status waiting">Connecting to the till…</p>
        ) : (
          <QrScanner onResult={(text) => joinAs(hostIdFrom(text))} allowManual={false} />
        )}
      </div>
    );
  }

  // ── Host view (this device initiated — it's the till) ────────────────────────
  return (
    <div className="card">
      <h1>Pair a device</h1>
      <p className="muted">
        This device is the till. Have the other device scan this code to pair — it stands in for the
        server, so changes sync across both.
      </p>
      {turnWarning}
      {error && <p className="error">{error}</p>}
      {peerId ? (
        <>
          <QrDisplay
            payload={appUrl(`/pair?host=${encodeURIComponent(peerId)}`)}
            label="Pairing QR"
            caption="Scan this on the other device"
          />
          <p className="status waiting">Waiting for the other device to connect…</p>
        </>
      ) : (
        <p>Starting a pairing session…</p>
      )}
      <p className="muted small">
        Joining another device instead?{' '}
        <button
          type="button"
          className="link"
          onClick={() => {
            unpair();
            started.current = false;
            setMode('join');
          }}
        >
          Scan its code
        </button>
        .
      </p>
    </div>
  );
}
