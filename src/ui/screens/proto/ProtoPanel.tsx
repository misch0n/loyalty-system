/**
 * ProtoPanel — the prototype-only tools panel (UI-SPEC §4.11), opened by tapping
 * the logo. It is the rebuilt home of the demo scaffolding that used to live in
 * the legacy prototype menu: this device's pairing QR (host), a scan shortcut,
 * unpair, a staff/admin sign-in shortcut, a danger "reset this device", and a few
 * demo-card shortcuts.
 *
 * Build-flag gating lives at the call site (App mounts/opens this only in
 * non-production). The unmistakably-"prototype" look comes from the kit
 * ProtoDrawer, hosted inside a kit Sheet so it shares the app's bottom-sheet
 * dismissal (scrim / Escape).
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Sheet, ProtoDrawer } from '../../kit';
import { QrDisplay } from '../../common/QrDisplay';
import { useServices } from '../../common/ServicesContext';
import { usePairing } from '../../common/PairingContext';
import { useAuth } from '../../app/AuthContext';
import { ROUTES, cardPath } from '../../app/routes';
import { appUrl } from '../../../config/links';
import { PRESET_CARD_TOKENS } from '../../../wallet/passes';
import './proto.css';

export interface ProtoPanelProps {
  open: boolean;
  onClose: () => void;
}

export function ProtoPanel({ open, onClose }: ProtoPanelProps): JSX.Element {
  const services = useServices();
  const navigate = useNavigate();
  const { actor } = useAuth();
  const { peerId, clientCount, joined, ensureHosting, unpair } = usePairing();

  // Start hosting (so a QR exists) whenever the panel opens and we're not a client.
  useEffect(() => {
    if (open && !joined) ensureHosting();
  }, [open, joined, ensureHosting]);

  function go(path: string) {
    onClose();
    navigate(path);
  }

  async function reset() {
    const ok = window.confirm(
      'Reset this device? Clears all local demo data on this device (card, sign-in, points) so you can run a workflow from scratch.',
    );
    if (!ok) return;
    onClose();
    await services.reset();
    localStorage.clear();
    sessionStorage.clear();
    window.location.hash = '#/';
    window.location.reload();
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <ProtoDrawer onClose={onClose}>
        <div className="proto-panel">
          {/* Pairing */}
          <section className="proto-panel__section">
            {joined ? (
              <p className="proto-panel__status">● Paired to the till</p>
            ) : (
              <>
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
                  <p className="proto-panel__status">Preparing pairing code…</p>
                )}
                <Button variant="line" block onClick={() => go(ROUTES.pair)}>
                  Scan a code
                </Button>
              </>
            )}
            {(joined || clientCount > 0) && (
              <Button
                variant="line"
                block
                onClick={() => {
                  onClose();
                  unpair();
                }}
              >
                Unpair{clientCount > 0 ? ` all (${clientCount})` : ''}
              </Button>
            )}
          </section>

          {/* Staff/admin sign in (only when not signed in) */}
          {!actor && (
            <section className="proto-panel__section">
              <Button variant="line" block onClick={() => go(ROUTES.login)}>
                Staff / admin sign in
              </Button>
            </section>
          )}

          {/* Demo cards */}
          <section className="proto-panel__section">
            {PRESET_CARD_TOKENS.map((token, i) => (
              <Button
                key={token}
                variant="ghost"
                block
                onClick={() => go(cardPath(token))}
              >
                Open demo card {i + 1}
              </Button>
            ))}
          </section>

          {/* Danger */}
          <section className="proto-panel__section">
            <Button variant="line" block onClick={reset}>
              Reset this device
            </Button>
          </section>
        </div>
      </ProtoDrawer>
    </Sheet>
  );
}

export default ProtoPanel;
