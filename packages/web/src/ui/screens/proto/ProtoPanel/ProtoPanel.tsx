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

import { useEffect, useRef, useState } from 'react';
import { Sheet } from '../../../components/Sheet/Sheet';
import { QrDisplay } from '../../../common/QrDisplay';
import { QrScanner } from '../../../common/QrScanner';
import { usePairing } from '../../../common/PairingContext';
import { useServices } from '../../../common/ServicesContext';
import { hasSnapshot } from '../../../common/storageSnapshot';
import { appUrl } from '../../../../config/links';
import './ProtoPanel.css';

/** Prototype storage diagnostic — what actually survived on this device. */
interface StorageDiag {
  standalone: boolean;
  recognized: boolean;
  /** Active customer count, or null when the store didn't respond (DB wedged). */
  customers: number | null;
  snapshot: boolean;
}

function isStandalone(): boolean {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)')?.matches === true;
}

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
  const services = useServices();
  const [scanning, setScanning] = useState(false);
  // Reset is a single self-arming button: first tap arms it (turns danger +
  // "Tap again to reset"), it decays back to normal over 3s and auto-disarms.
  const [armed, setArmed] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [diag, setDiag] = useState<StorageDiag | null>(null);

  // While paired, show the TILL's QR (joinedHostId) so any device can grow the
  // network by scanning this screen; otherwise show our own host QR.
  const displayId = joined ? joinedHostId : peerId;

  // Storage diagnostic: read what's actually persisted whenever the panel opens.
  // Lets a tester reload (esp. iOS home-screen) and SEE whether recognition
  // (localStorage) and/or card data (IndexedDB) survived.
  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      // Recognition is localStorage (can't hang). The customer count is the DB —
      // if it's wedged, time it out so the panel reports "unavailable" instead of
      // showing nothing (the symptom that looked like the diagnostic was removed).
      const token = await services.identity.get().catch(() => null);
      let customers: number | null = null;
      try {
        customers = await Promise.race([
          services.store.countActiveCustomers(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('store timeout')), 4000),
          ),
        ]);
      } catch {
        customers = null;
      }
      if (!active) return;
      setDiag({
        standalone: isStandalone(),
        recognized: Boolean(token),
        customers,
        snapshot: hasSnapshot(),
      });
    })();
    return () => {
      active = false;
    };
  }, [open, services]);

  // Start hosting (so a pairing QR exists) whenever the panel opens, unless we're
  // already a client of another till.
  useEffect(() => {
    if (open && !joined) ensureHosting();
  }, [open, joined, ensureHosting]);

  // Leave the inline scanner once we've actually paired.
  useEffect(() => {
    if (joined) setScanning(false);
  }, [joined]);

  // Reset to the controls view whenever the panel re-opens / closes; closing the
  // panel also cancels a pending reset (disarms the button).
  useEffect(() => {
    if (!open) {
      setScanning(false);
      disarm();
    }
  }, [open]);

  // Clean up the arm timer on unmount.
  useEffect(() => () => disarm(), []);

  function disarm(): void {
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = null;
    setArmed(false);
  }

  // First tap arms; the button decays back to its normal colour over 3s (CSS) and
  // auto-disarms here, so an accidental tap quietly reverts.
  function armReset(): void {
    setArmed(true);
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => disarm(), 3000);
  }

  // In-app two-step confirm (window.confirm is suppressed in iOS standalone).
  async function doReset(): Promise<void> {
    disarm();
    onClose();
    // Role-aware; PairingContext does a graceful in-place wipe, or hard-recovers
    // (delete + reload) if the store is wedged.
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

            {/* 3 · Reset — single self-arming button (tap to arm, tap again to
                reset; auto-disarms after 3s, and closing the panel cancels it) */}
            <div className="grp">
              {armed && (
                <p className="proto-status">
                  {joined
                    ? 'Clears this device only (card + sign-in). The till keeps its data.'
                    : 'Wipes all data on this device. Paired devices are disconnected.'}
                </p>
              )}
              <button
                type="button"
                className={`pbtn${armed ? ' pbtn-arming' : ''}`}
                onClick={() => (armed ? void doReset() : armReset())}
              >
                {armed ? 'Tap again to reset' : 'Reset'}
              </button>
            </div>

            {/* Storage diagnostic — reload (esp. iOS home-screen) and read what
                survived: recognition (localStorage) vs card data (IndexedDB). */}
            {diag && (
              <dl className="proto-diag" aria-label="Storage diagnostic">
                <div>
                  <dt>display</dt>
                  <dd>{diag.standalone ? 'home-screen (standalone)' : 'browser tab'}</dd>
                </div>
                <div>
                  <dt>recognition · localStorage</dt>
                  <dd>{diag.recognized ? 'present' : 'none'}</dd>
                </div>
                <div>
                  <dt>card data · IndexedDB</dt>
                  <dd>
                    {diag.customers === null
                      ? 'unavailable — store not responding'
                      : `${diag.customers} customer${diag.customers === 1 ? '' : 's'}`}
                  </dd>
                </div>
                <div>
                  <dt>pairing snapshot</dt>
                  <dd>{diag.snapshot ? 'present' : 'none'}</dd>
                </div>
              </dl>
            )}
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
