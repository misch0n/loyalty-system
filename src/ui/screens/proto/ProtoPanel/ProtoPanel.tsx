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

import { useEffect, useState } from 'react';
import { Sheet } from '../../../components/Sheet/Sheet';
import { QrDisplay } from '../../../common/QrDisplay';
import { QrScanner } from '../../../common/QrScanner';
import { usePairing } from '../../../common/PairingContext';
import { appUrl } from '../../../../config/links';
import './ProtoPanel.css';

/** Accept either a bare peer id or a full pairing URL carrying `?host=`. */
function hostIdFrom(text: string): string {
  const match = text.match(/[?&]host=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : text.trim();
}

export interface ProtoPanelProps {
  open: boolean;
  onClose: () => void;
}

export function ProtoPanel({ open, onClose }: ProtoPanelProps): JSX.Element | null {
  const {
    peerId,
    joinedHostId,
    clientCount,
    joined,
    connecting,
    ensureHosting,
    joinAs,
    unpair,
    reset: pairingReset,
  } = usePairing();
  const [scanning, setScanning] = useState(false);

  // While paired, show the TILL's QR (joinedHostId) so any device can grow the
  // network by scanning this screen; otherwise show our own host QR.
  const displayId = joined ? joinedHostId : peerId;

  // Start hosting (so a pairing QR exists) whenever the panel opens, unless we're
  // already a client of another till.
  useEffect(() => {
    if (open && !joined) ensureHosting();
  }, [open, joined, ensureHosting]);

  // Leave the inline scanner once we've actually paired.
  useEffect(() => {
    if (joined) setScanning(false);
  }, [joined]);

  // Reset to the controls view whenever the panel re-opens.
  useEffect(() => {
    if (!open) setScanning(false);
  }, [open]);

  async function reset(): Promise<void> {
    const ok = window.confirm(
      joined
        ? 'Reset this device? Clears this device only (card + sign-in) so you can ' +
            'test as a brand-new customer. The till keeps all of its data.'
        : 'Reset the demo? Wipes all data on this device (cards, points, sign-in) ' +
            'and starts clean. Any devices paired to this one are disconnected.',
    );
    if (!ok) return;
    onClose();
    // Role-aware + reload-free; PairingContext handles client vs host/unpaired.
    await pairingReset();
  }

  if (!open) return null;

  return (
    <Sheet open={open} onClose={onClose} label="Developer tools">
      <div className="proto">
        <div className="ph">
          <span className="badge">Prototype</span>
          <span className="pt">developer tools · not shipped</span>
        </div>

        {scanning ? (
          // Inline camera — stays right here in the dev panel (no navigation, no
          // modal), mirroring the staff scan workflow's in-view camera.
          <>
            <div className="grp">
              <div className="lab">Scan a till to pair</div>
              {connecting ? (
                <p className="proto-status">Connecting to the till…</p>
              ) : (
                <QrScanner
                  autoStart
                  allowManual={false}
                  onResult={(text) => void joinAs(hostIdFrom(text), { redirect: false })}
                />
              )}
            </div>
            <div className="grp">
              <button type="button" className="pbtn" onClick={() => setScanning(false)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            {/* 1 · QR — our own till QR, or the till's QR while we're a client */}
            <div className="grp">
              {displayId ? (
                <div className="proto-qr">
                  <QrDisplay
                    payload={appUrl(`/pair?host=${encodeURIComponent(displayId)}`)}
                    label="Pairing QR"
                    caption={
                      joined
                        ? 'Paired to the till · scan to add another device'
                        : clientCount > 0
                          ? `${clientCount} device${clientCount === 1 ? '' : 's'} paired · scan to add more`
                          : 'Scan this on another device to pair'
                    }
                  />
                </div>
              ) : (
                <p className="proto-status">
                  {joined ? 'Paired to the till' : 'Preparing pairing code…'}
                </p>
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
                <button type="button" className="pbtn" onClick={() => setScanning(true)}>
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
          </>
        )}
      </div>
      <p className="card-hint" style={{ marginTop: 16, textAlign: 'center' }}>
        Build-flag gated · stripped from production builds.
      </p>
    </Sheet>
  );
}

export default ProtoPanel;
