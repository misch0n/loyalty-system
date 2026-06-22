/**
 * PairDevices — the prototype pairing screen (the server stand-in).
 *
 * Staff device HOSTS: shows a pairing QR (its peer id) for the customer to scan.
 * Customer device JOINS: scans that QR (camera preview) to connect. Once paired,
 * the customer's store is served by the staff device over PeerJS, so points,
 * recovery, etc. reflect on both devices live. Prototype-only.
 */

import { useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useSession } from './SessionContext';
import { usePairing } from './PairingContext';
import { QrDisplay } from './QrDisplay';
import { QrScanner } from './QrScanner';
import { appUrl } from '../../config/links';

/** Accept either a bare peer id or a full pairing URL carrying `?host=`. */
function hostIdFrom(text: string): string {
  const match = text.match(/[?&]host=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : text.trim();
}

export function PairDevices() {
  const { actor } = useSession();
  const { status, role, peerId, error, startHosting, joinAs, unpair } = usePairing();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const autoJoined = useRef(false);

  const isStaff = Boolean(actor);
  const hostParam = params.get('host');

  // Staff: open a pairing session automatically. Customer with a scanned-URL
  // host param: auto-join once.
  useEffect(() => {
    if (isStaff && status === 'idle') {
      void startHosting();
    } else if (!isStaff && hostParam && status === 'idle' && !autoJoined.current) {
      autoJoined.current = true;
      void joinAs(hostParam);
    }
  }, [isStaff, hostParam, status, startHosting, joinAs]);

  if (status === 'paired') {
    return (
      <div className="card">
        <h1>Devices paired</h1>
        <p className="status joined">
          ● Connected {role === 'host' ? 'to the customer device' : 'to the till'}. Changes now
          sync live for this session.
        </p>
        {!isStaff && (
          <p>
            <Link className="button primary" to="/">
              Open my card
            </Link>
          </p>
        )}
        <button type="button" className="link" onClick={unpair}>
          Unpair
        </button>
        <p className="muted small">Prototype only — production coordinates this through the server.</p>
      </div>
    );
  }

  // ── Staff host view ──────────────────────────────────────────────────────────
  if (isStaff) {
    return (
      <div className="card">
        <h1>Pair a customer device</h1>
        <p className="muted">
          Prototype only: have the customer open <strong>Pair with the till</strong> and scan this
          code. It stands in for the server so their screen updates as you add points.
        </p>
        {error && <p className="error">{error}</p>}
        {peerId ? (
          <>
            <QrDisplay
              payload={appUrl(`/pair?host=${encodeURIComponent(peerId)}`)}
              label="Pairing QR"
              caption="Customer scans this to pair"
            />
            <p className="status waiting">Waiting for the customer device to connect…</p>
            <button type="button" className="link" onClick={unpair}>
              Cancel
            </button>
          </>
        ) : (
          <p>Starting a pairing session…</p>
        )}
      </div>
    );
  }

  // ── Customer join view ───────────────────────────────────────────────────────
  return (
    <div className="card">
      <h1>Pair with the till</h1>
      <p className="muted">
        Point your camera at the pairing code on the staff screen. While paired, your points update
        the moment staff add them.
      </p>
      {error && <p className="error">{error}</p>}
      {status === 'connecting' ? (
        <p className="status waiting">Connecting to the till…</p>
      ) : (
        <QrScanner onResult={(text) => joinAs(hostIdFrom(text))} manualLabel="Pairing code" />
      )}
      <p className="muted small">
        Don't have a card yet? <button type="button" className="link" onClick={() => navigate('/register')}>Join first</button>.
      </p>
    </div>
  );
}
