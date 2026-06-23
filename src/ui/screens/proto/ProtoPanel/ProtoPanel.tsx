/**
 * ProtoPanel — the prototype-only developer tools panel (reference view 12).
 *
 * DEMO ONLY. Opened by the hidden top-left `DevTrigger` (the caller, App, gates
 * this on `isPrototype` and stays a no-op in production). The unmistakably
 * utilitarian dark/mono look (donor `.proto`) means it can never be confused for
 * production UI. Hosted inside the shared bottom `Sheet` so it shares the app's
 * scrim / Escape dismissal.
 *
 * Stripped to the three controls a tester actually needs, centred and in order:
 *   1. QR            — this device's pairing QR (so another device can pair)
 *   2. Scan to pair  — join another device's till
 *   3. Reset         — wipe local demo data and start clean
 *
 * There is no demo-card jumping or view-jumping: every prototype card starts at
 * zero and registration simply rotates which preset token is handed out. Wiring
 * for pairing/reset is reused from `PairingContext` + `services.reset()`.
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet } from '../../../components/Sheet/Sheet';
import { QrDisplay } from '../../../common/QrDisplay';
import { useServices } from '../../../common/ServicesContext';
import { usePairing } from '../../../common/PairingContext';
import { ROUTES } from '../../../app/routes';
import { appUrl } from '../../../../config/links';
import './ProtoPanel.css';

export interface ProtoPanelProps {
  open: boolean;
  onClose: () => void;
}

export function ProtoPanel({ open, onClose }: ProtoPanelProps): JSX.Element | null {
  const services = useServices();
  const navigate = useNavigate();
  const { peerId, clientCount, joined, ensureHosting, unpair } = usePairing();

  // Start hosting (so a pairing QR exists) whenever the panel opens, unless we're
  // already a client of another till.
  useEffect(() => {
    if (open && !joined) ensureHosting();
  }, [open, joined, ensureHosting]);

  function go(path: string): void {
    onClose();
    navigate(path);
  }

  async function reset(): Promise<void> {
    const ok = window.confirm(
      'Reset the demo? Clears all local demo data on this device ' +
        '(card, sign-in, points) so you can run a workflow from scratch.',
    );
    if (!ok) return;
    onClose();
    await services.reset();
    localStorage.clear();
    sessionStorage.clear();
    window.location.hash = '#/';
    window.location.reload();
  }

  if (!open) return null;

  return (
    <Sheet open={open} onClose={onClose} label="Developer tools">
      <div className="proto">
        <div className="ph">
          <span className="badge">Prototype</span>
          <span className="pt">developer tools · not shipped</span>
        </div>

        {/* 1 · QR */}
        <div className="grp">
          {joined ? (
            <p className="proto-status">● Paired to the till</p>
          ) : peerId ? (
            <div className="proto-qr">
              <QrDisplay
                payload={appUrl(`/pair?host=${encodeURIComponent(peerId)}`)}
                label="Pairing QR"
                caption={
                  clientCount > 0
                    ? `${clientCount} device${clientCount === 1 ? '' : 's'} paired · scan to add more`
                    : 'Scan this on another device to pair'
                }
              />
            </div>
          ) : (
            <p className="proto-status">Preparing pairing code…</p>
          )}
        </div>

        {/* 2 · Scan to pair (or unpair when already paired) */}
        <div className="grp">
          {joined || clientCount > 0 ? (
            <button
              type="button"
              className="pbtn"
              onClick={() => {
                onClose();
                unpair();
              }}
            >
              Unpair{clientCount > 0 ? ` all (${clientCount})` : ''}
            </button>
          ) : (
            <button type="button" className="pbtn" onClick={() => go(ROUTES.pair)}>
              Scan to pair
            </button>
          )}
        </div>

        {/* 3 · Reset */}
        <div className="grp">
          <button type="button" className="pbtn" onClick={reset}>
            Reset
          </button>
        </div>
      </div>
      <p className="card-hint" style={{ marginTop: 16, textAlign: 'center' }}>
        Build-flag gated · stripped from production builds.
      </p>
    </Sheet>
  );
}

export default ProtoPanel;
