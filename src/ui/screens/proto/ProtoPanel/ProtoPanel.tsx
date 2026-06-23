/**
 * ProtoPanel — the prototype-only "Prototype" tools panel (reference view 12).
 *
 * DEMO ONLY. Opened by a right-half tap on the logo (the caller, App, gates this
 * on `isPrototype` and stays a no-op in production). The unmistakably-utilitarian
 * dark/mono look (donor `.proto`) means it can never be confused for production
 * UI. Hosted inside the shared bottom `Sheet` so it shares the app's scrim /
 * Escape dismissal.
 *
 * It is a thin restyle of the legacy proto menu: switch the active demo customer
 * across the predefined ids (→ pre-generated wallet passes), jump to a view,
 * reset/reseed the demo ledger, and the device-pairing controls (this device's
 * pairing QR, scan, unpair). Wiring is reused verbatim from the old panel and
 * `PairingContext`; only the markup/styling changed.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet } from '../../../components/Sheet/Sheet';
import { QrDisplay } from '../../../common/QrDisplay';
import { useServices } from '../../../common/ServicesContext';
import { usePairing } from '../../../common/PairingContext';
import { useAuth } from '../../../app/AuthContext';
import { ROUTES, cardPath } from '../../../app/routes';
import { appUrl } from '../../../../config/links';
import { PRESET_CARD_TOKENS } from '../../../../wallet/passes';
import './ProtoPanel.css';

export interface ProtoPanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Static descriptors for the three preset demo cards. `state`/`progress` are the
 * seeded states the predefined ids map to; they label the controls only — the
 * panel does not fabricate ledger seeding beyond what `services.reset()` does.
 */
const DEMO_CARDS: ReadonlyArray<{ token: string; id: string; state: string; progress: string }> = [
  { token: PRESET_CARD_TOKENS[0], id: 'card1', state: 'Fresh', progress: '0/10' },
  { token: PRESET_CARD_TOKENS[1], id: 'card2', state: 'Mid', progress: '7/10' },
  { token: PRESET_CARD_TOKENS[2], id: 'card3', state: 'Reward', progress: '10/10' },
];

/** Short, non-PII display code for a token (mirrors the donor "5YUrTHtx"). */
function shortCode(token: string): string {
  return token.slice(-8);
}

export function ProtoPanel({ open, onClose }: ProtoPanelProps): JSX.Element | null {
  const services = useServices();
  const navigate = useNavigate();
  const { actor } = useAuth();
  const { peerId, clientCount, joined, ensureHosting, unpair } = usePairing();

  // Active demo customer = which preset card the "Jump to view · Card" acts on.
  const [activeToken, setActiveToken] = useState<string>(PRESET_CARD_TOKENS[0]);

  // Start hosting (so a pairing QR exists) whenever the panel opens, unless we're
  // already a client of another till.
  useEffect(() => {
    if (open && !joined) ensureHosting();
  }, [open, joined, ensureHosting]);

  function go(path: string): void {
    onClose();
    navigate(path);
  }

  function selectDemo(token: string): void {
    setActiveToken(token);
    go(cardPath(token));
  }

  async function reset(): Promise<void> {
    const ok = window.confirm(
      'Reset & reseed the demo ledger? Clears all local demo data on this device ' +
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
    <Sheet open={open} onClose={onClose} label="Prototype tools">
      <div className="proto">
        <div className="ph">
          <span className="badge">Prototype</span>
          <span className="pt">demo controls · not shipped</span>
        </div>

        <div className="grp">
          <div className="lab">Active customer (predefined ids → pre-generated passes)</div>
          <select
            value={activeToken}
            onChange={(e) => selectDemo(e.target.value)}
            aria-label="Active demo customer"
          >
            {DEMO_CARDS.map((c) => (
              <option key={c.token} value={c.token}>
                {`${c.id} · ${shortCode(c.token)} · ${c.state.toLowerCase()} (${c.progress})`}
              </option>
            ))}
          </select>
        </div>

        <div className="grp">
          <div className="lab">Jump card state</div>
          <div className="prow">
            {DEMO_CARDS.map((c) => (
              <button
                key={c.token}
                type="button"
                className={`pbtn${c.token === activeToken ? ' on' : ''}`}
                onClick={() => selectDemo(c.token)}
              >
                {c.state}
              </button>
            ))}
          </div>
        </div>

        <div className="grp">
          <div className="lab">Data</div>
          <button type="button" className="pbtn" onClick={reset}>
            Reset &amp; reseed demo ledger
          </button>
        </div>

        <div className="grp">
          <div className="lab">Jump to view</div>
          <div className="prow">
            <button type="button" className="pbtn" onClick={() => go(cardPath(activeToken))}>
              Card
            </button>
            <button type="button" className="pbtn" onClick={() => go(ROUTES.staff)}>
              Staff
            </button>
            <button type="button" className="pbtn" onClick={() => go(ROUTES.admin)}>
              Admin
            </button>
          </div>
        </div>

        <div className="grp">
          <div className="lab">Device pairing</div>
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
          <div className="prow" style={{ gridTemplateColumns: joined || clientCount > 0 ? '1fr 1fr' : '1fr' }}>
            {!joined && (
              <button type="button" className="pbtn" onClick={() => go(ROUTES.pair)}>
                Scan a code
              </button>
            )}
            {(joined || clientCount > 0) && (
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
            )}
          </div>
        </div>

        {!actor && (
          <div className="grp">
            <div className="lab">Staff / admin</div>
            <button type="button" className="pbtn" onClick={() => go(ROUTES.login)}>
              Sign in
            </button>
          </div>
        )}
      </div>
      <p className="card-hint" style={{ marginTop: 16, textAlign: 'center' }}>
        Build-flag gated · stripped from production builds.
      </p>
    </Sheet>
  );
}

export default ProtoPanel;
