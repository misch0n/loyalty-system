/**
 * PrototypeMenu — collapses the demo-only scaffolding behind the "prototype"
 * label in the header. Opening it shows this device's pairing QR (so another
 * device can scan to pair) with a Scan button beneath, plus Unpair, a Reset that
 * wipes this device's local data, and a sign-in shortcut. Once this device is a
 * customer of a till it shows a paired label instead of a QR. None of this exists
 * in production.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useServices } from './ServicesContext';
import { usePairing } from './PairingContext';
import { useSession } from './SessionContext';
import { QrDisplay } from './QrDisplay';
import { appUrl } from '../../config/links';

export function PrototypeMenu() {
  const services = useServices();
  const { peerId, clientCount, joined, ensureHosting, unpair } = usePairing();
  const { actor } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Start hosting (so a QR exists) whenever the menu opens and we're not a client.
  useEffect(() => {
    if (open && !joined) ensureHosting();
  }, [open, joined, ensureHosting]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function go(path: string) {
    setOpen(false);
    navigate(path);
  }

  async function reset() {
    setOpen(false);
    const ok = window.confirm(
      'Reset this device? Clears all local demo data on this device (card, sign-in, points) so you can run a workflow from scratch.',
    );
    if (!ok) return;
    await services.reset();
    localStorage.clear();
    sessionStorage.clear();
    window.location.hash = '#/';
    window.location.reload();
  }

  const tag =
    clientCount > 0 ? `· ${clientCount}` : joined ? '●' : '▾';

  return (
    <div className="proto-menu" ref={ref}>
      <button
        type="button"
        className="proto-tag"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Prototype tools"
        onClick={() => setOpen((v) => !v)}
      >
        prototype {tag}
      </button>
      {open && (
        <div className="proto-dropdown" role="menu">
          <p className="proto-dropdown-head">Prototype tools</p>

          {joined ? (
            <p className="status joined proto-paired">● Paired to the till</p>
          ) : (
            <div className="proto-pair">
              {peerId ? (
                <QrDisplay
                  payload={appUrl(`/pair?host=${encodeURIComponent(peerId)}`)}
                  label="Pairing QR"
                  caption={
                    clientCount > 0
                      ? `${clientCount} device${clientCount === 1 ? '' : 's'} paired · scan to add more`
                      : 'Scan this on another device to pair'
                  }
                />
              ) : (
                <p className="muted small">Preparing pairing code…</p>
              )}
              <button type="button" role="menuitem" onClick={() => go('/pair')}>
                Scan a code
              </button>
            </div>
          )}

          {(joined || clientCount > 0) && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                unpair();
              }}
            >
              Unpair{clientCount > 0 ? ` all (${clientCount})` : ''}
            </button>
          )}

          {!actor && (
            <button type="button" role="menuitem" onClick={() => go('/login')}>
              Staff / admin sign in
            </button>
          )}

          <button type="button" role="menuitem" className="danger" onClick={reset}>
            Reset this device
          </button>
        </div>
      )}
    </div>
  );
}
