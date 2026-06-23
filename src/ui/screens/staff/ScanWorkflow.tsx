/**
 * ScanWorkflow — the staff scan + credit flow (UI-SPEC §4.9, UX-SPEC §7).
 *
 * One screen, sequenced states (not separate routes):
 *   scanning  — live camera in a kit ScanFrame; decode → resolve a customer
 *   resolved  — the customer's card as confirmation, then the credit controls
 *   notfound  — unknown code → staff-registration escape hatch
 *
 * Every credit/redeem/undo is staff-initiated and passes the authenticated
 * `actor` to the loyalty service; balances stay append-only (undo is a
 * `reverse`, never a destructive edit). After a write we re-derive state from
 * the ledger, update the card live, and best-effort push a wallet update
 * (no-op on the prototype Free tier — the web card is the source of truth).
 *
 * UI → services only: camera decoding uses the qr helpers; all reads/writes go
 * through `services.loyalty` / `services.customers`. `recordActivity()` fires on
 * every scan/credit/redeem to keep the session alive.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  CupStamps,
  CustomerChip,
  PointsSlider,
  ScanFrame,
  useToast,
} from '../../kit';
import { useAuth } from '../../app/AuthContext';
import { ROUTES } from '../../app/routes';
import { useServices } from '../../common/ServicesContext';
import { useStaffGuard } from './useStaffGuard';
import { startScanner, type ScannerHandle } from '../../../qr/scan';
import { tokenFromCardScan } from '../../../qr/encode';
import type { CustomerState } from '../../../services/LoyaltyService';
import './staff.css';

const SCAN_REGION_ID = 'staff-scan-region';
/** Hard ceiling on the multi-add slider regardless of config (UI-SPEC §4.9). */
const SLIDER_HARD_CAP = 3;

type Phase = 'scanning' | 'resolved' | 'notfound';

export function ScanWorkflow(): JSX.Element {
  const guard = useStaffGuard();
  const services = useServices();
  const navigate = useNavigate();
  const toast = useToast();
  const { recordActivity } = useAuth();

  const [phase, setPhase] = useState<Phase>('scanning');
  const [state, setState] = useState<CustomerState | null>(null);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [points, setPoints] = useState(1);
  const [busy, setBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [manual, setManual] = useState('');

  const scannerRef = useRef<ScannerHandle | null>(null);
  const resolvingRef = useRef(false);

  const stopCamera = useCallback(async () => {
    const handle = scannerRef.current;
    scannerRef.current = null;
    if (handle) await handle.stop();
  }, []);

  // ── resolve a scanned/typed code ────────────────────────────────────────
  const resolve = useCallback(
    async (text: string) => {
      if (resolvingRef.current) return;
      resolvingRef.current = true;
      recordActivity();
      const token = tokenFromCardScan(text);
      await stopCamera();
      setActionError(null);
      try {
        const next = await services.loyalty.getStateByToken(token);
        if (next) {
          setState(next);
          setPoints(1);
          setPhase('resolved');
        } else {
          setPendingToken(token);
          setPhase('notfound');
        }
      } catch {
        setPendingToken(token);
        setPhase('notfound');
      } finally {
        resolvingRef.current = false;
      }
    },
    [services, stopCamera, recordActivity],
  );

  // ── camera lifecycle (only while scanning) ──────────────────────────────
  useEffect(() => {
    if (phase !== 'scanning') return;
    let cancelled = false;
    setCameraError(null);
    void (async () => {
      try {
        const handle = await startScanner(SCAN_REGION_ID, (text) => {
          void resolve(text);
        });
        if (cancelled) {
          await handle.stop();
          return;
        }
        scannerRef.current = handle;
      } catch {
        if (!cancelled) {
          setCameraError(
            'Camera unavailable. On a phone, allow camera access; otherwise type the code below.',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      void stopCamera();
    };
  }, [phase, resolve, stopCamera]);

  // Stop the camera if the screen unmounts mid-scan.
  useEffect(() => () => void stopCamera(), [stopCamera]);

  if (guard.redirect) return guard.redirect;
  const actor = guard.actor;

  // ── derived view helpers ────────────────────────────────────────────────
  const config = state?.config;
  const threshold = config?.pointsPerReward ?? 10;
  const balance = state?.balance ?? 0;
  const filled = state?.progress.current ?? 0;
  const rewardReady = state?.rewardAvailable ?? false;
  const sliderMax = Math.min(config?.maxPointsPerTransaction ?? SLIDER_HARD_CAP, SLIDER_HARD_CAP);
  const customerName = state?.customer.displayName?.trim() || 'Member';
  const toGo = Math.max(0, threshold - balance);

  /** Most recent non-reversal entry (the candidate for "undo last entry"). */
  const lastEntry = state
    ? [...state.transactions].reverse().find((t) => t.type !== 'reversal')
    : undefined;

  const backToPanel = () => {
    recordActivity();
    void stopCamera();
    navigate(ROUTES.staff);
  };

  const scanNext = () => {
    recordActivity();
    setState(null);
    setActionError(null);
    setPendingToken(null);
    setManual('');
    setPhase('scanning');
  };

  // ── best-effort wallet push (never blocks the UI) ───────────────────────
  const pushWallet = (customerId: string, derived: { balance: number; rewardAvailable: boolean }) => {
    void services.wallet.pushUpdate(customerId, derived).catch(() => {
      // Free-tier prototype: no-op. Web card remains the source of truth.
    });
  };

  const refresh = async (customerId: string): Promise<CustomerState | null> => {
    const next = await services.loyalty.getStateById(customerId);
    if (next) setState(next);
    return next;
  };

  // ── actions (all staff-initiated, pass the actor) ───────────────────────
  const onAdd = async () => {
    if (!state || busy) return;
    setBusy(true);
    setActionError(null);
    recordActivity();
    try {
      const added = Math.min(points, sliderMax);
      await services.loyalty.accrue(actor, state.customer.id, added);
      const next = await refresh(state.customer.id);
      if (next) {
        pushWallet(next.customer.id, {
          balance: next.balance,
          rewardAvailable: next.rewardAvailable,
        });
        const name = next.customer.displayName?.trim() || 'Member';
        toast.show(`Added ${added} · ${name} now at ${next.progress.current}/${next.progress.threshold}`, {
          tone: 'success',
        });
      }
      setPoints(1);
    } catch {
      setActionError('Could not add coffees. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const onRedeem = async () => {
    if (!state || busy || !rewardReady) return;
    setBusy(true);
    setActionError(null);
    recordActivity();
    try {
      const result = await services.loyalty.redeem(actor, state.customer.id);
      if (!result.ok) {
        setActionError(
          result.reason ?? 'Could not redeem — they may not have enough coffees yet.',
        );
        await refresh(state.customer.id);
        return;
      }
      const next = await refresh(state.customer.id);
      if (next) {
        pushWallet(next.customer.id, {
          balance: next.balance,
          rewardAvailable: next.rewardAvailable,
        });
        const name = next.customer.displayName?.trim() || 'Member';
        toast.show(`Reward redeemed · ${name} now at ${next.progress.current}/${next.progress.threshold}`, {
          tone: 'success',
        });
      }
    } catch {
      setActionError('Could not redeem. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const onUndo = async () => {
    if (!state || busy || !lastEntry) return;
    setBusy(true);
    setActionError(null);
    recordActivity();
    try {
      await services.loyalty.reverse(actor, state.customer.id, lastEntry.id);
      const next = await refresh(state.customer.id);
      if (next) {
        pushWallet(next.customer.id, {
          balance: next.balance,
          rewardAvailable: next.rewardAvailable,
        });
        toast.show('Last entry undone', { tone: 'default' });
      }
    } catch {
      setActionError('Could not undo that entry. It may have already been reversed.');
    } finally {
      setBusy(false);
    }
  };

  // ── staff-registration escape hatch (not found) ─────────────────────────
  const onProvision = async () => {
    if (!pendingToken || busy) return;
    setBusy(true);
    setActionError(null);
    recordActivity();
    try {
      const customer = await services.customers.provisionFromToken(actor, pendingToken);
      const next = await services.loyalty.getStateById(customer.id);
      if (next) {
        setState(next);
        setPoints(1);
        setPhase('resolved');
        setPendingToken(null);
      } else {
        setActionError('Created the card, but could not load it. Scan it again.');
      }
    } catch {
      setActionError("Could not create a card for that code. It may not be a valid card code.");
    } finally {
      setBusy(false);
    }
  };

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    const value = manual.trim();
    if (value) void resolve(value);
  };

  return (
    <div className="staff-screen">
      <div className="staff-screen__col">
        {phase === 'scanning' && (
          <>
            <ScanFrame hint="Point at the customer’s code.">
              <div id={SCAN_REGION_ID} className="staff-scan__region" />
            </ScanFrame>
            {cameraError && <p className="staff-scan__error">{cameraError}</p>}
            <form className="staff-scan__manual" onSubmit={submitManual}>
              <label>
                Customer code
                <input
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  placeholder="Paste or type the card code"
                  autoComplete="off"
                  inputMode="text"
                />
              </label>
              <Button variant="line" block type="submit" disabled={!manual.trim()}>
                Look up
              </Button>
            </form>
            <div className="staff-scan__actions">
              <Button variant="ghost" onClick={backToPanel}>
                Back
              </Button>
            </div>
          </>
        )}

        {phase === 'notfound' && (
          <>
            <Card name="Card not found" variant="collecting">
              <p>
                That code doesn’t match a card yet. You can create one for the customer now and
                add their coffees.
              </p>
            </Card>
            {actionError && <p className="staff-scan__error">{actionError}</p>}
            <div className="staff-scan__actions">
              <Button variant="forest" block onClick={() => void onProvision()} disabled={busy}>
                Create a card and continue
              </Button>
              <Button variant="ghost" onClick={scanNext} disabled={busy}>
                Scan next
              </Button>
            </div>
          </>
        )}

        {phase === 'resolved' && state && (
          <>
            <ScanFrame success hint={undefined} />

            <Card
              name={customerName}
              variant={rewardReady ? 'reward' : 'collecting'}
              rewardBanner="Reward ready — redeem at the counter"
            >
              <CupStamps filled={filled} total={threshold} />
              <CustomerChip
                name={customerName}
                filled={filled}
                total={threshold}
                status={rewardReady ? 'Reward ready' : 'Collecting'}
                statusTone={rewardReady ? 'sage' : 'forest'}
              />
            </Card>

            {actionError && <p className="staff-scan__error">{actionError}</p>}

            <PointsSlider
              value={points}
              onChange={setPoints}
              max={sliderMax}
              disabled={busy}
              label="Coffees to add"
            />

            <div className="staff-scan__actions">
              <Button variant="forest" block onClick={() => void onAdd()} disabled={busy}>
                {`Add ${Math.min(points, sliderMax)} ${
                  Math.min(points, sliderMax) === 1 ? 'coffee' : 'coffees'
                }`}
              </Button>

              <Button
                variant="line"
                block
                onClick={() => void onRedeem()}
                disabled={busy || !rewardReady}
              >
                {rewardReady
                  ? 'Redeem reward'
                  : `Unlocks at ${threshold} — ${toGo} to go`}
              </Button>

              <Button
                variant="ghost"
                onClick={() => void onUndo()}
                disabled={busy || !lastEntry}
              >
                Undo last entry
              </Button>

              <Button variant="ghost" onClick={scanNext} disabled={busy}>
                Scan next
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
