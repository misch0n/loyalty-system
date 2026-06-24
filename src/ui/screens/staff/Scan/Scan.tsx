/**
 * Staff scan workflow (Ckyka view 10) — one screen, sequenced states (not
 * separate routes):
 *   scanning  — live camera inside the `<ScanView>` frame; decode → resolve
 *   resolved  — camera collapses; `<CustChip>` confirms WHO, then the credit
 *               controls (add slider, redeem gated ≥ threshold, undo, scan next)
 *   notfound  — unknown code → staff-registration escape hatch
 *
 * Every credit/redeem/undo is staff-initiated, passes the authenticated `actor`
 * to the loyalty service, and stays append-only (undo is a `reverse`, never a
 * destructive edit). After a write we re-derive from the ledger, refresh the
 * chip, toast a confirmation, and best-effort push a wallet update (no-op on the
 * prototype Free tier). UI → services only; reuses the old ScanWorkflow wiring,
 * restyled to the reference markup. Guarded like the panel via `useStaffGuard`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../../components/Button/Button';
import { PointsSlider } from '../../../components/Slider/Slider';
import { useToast } from '../../../components/Toast/Toast';
import { useAuth } from '../../../app/AuthContext';
import { ROUTES } from '../../../app/routes';
import { useServices } from '../../../common/ServicesContext';
import { TopBar, ScanView, CustChip, StateLabel } from '../_parts';
import { useStaffGuard } from '../useStaffGuard';
import { startScanner, type ScannerHandle } from '../../../../qr/scan';
import { tokenFromCardScan } from '../../../../qr/encode';
import { normalizeShortCode } from '../../../../domain/tokens';
import type { CustomerState } from '../../../../services/LoyaltyService';
import './Scan.css';

const SCAN_REGION_ID = 'staff-scan-region';
/** Hard ceiling on the multi-add slider regardless of config (Ckyka view 10). */
const SLIDER_HARD_CAP = 3;

type Phase = 'scanning' | 'resolved' | 'notfound';

function coffeeLabel(n: number): string {
  return `Add ${n} ${n === 1 ? 'coffee' : 'coffees'}`;
}

export function Scan(): JSX.Element {
  const guard = useStaffGuard();
  const services = useServices();
  const navigate = useNavigate();
  const toast = useToast();
  const { recordActivity } = useAuth();

  const [phase, setPhase] = useState<Phase>('scanning');
  const [state, setState] = useState<CustomerState | null>(null);
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
          setPhase('notfound');
        }
      } catch {
        setPhase('notfound');
      } finally {
        resolvingRef.current = false;
      }
    },
    [services, stopCamera, recordActivity],
  );

  // ── resolve a typed SHORT CODE (camera-fail fallback) ───────────────────
  const resolveCode = useCallback(
    async (raw: string) => {
      const code = normalizeShortCode(raw);
      if (!code || resolvingRef.current) return;
      resolvingRef.current = true;
      recordActivity();
      await stopCamera();
      setActionError(null);
      try {
        const next = await services.loyalty.getStateByShortCode(code);
        if (next) {
          setState(next);
          setPoints(1);
          setPhase('resolved');
        } else {
          setPhase('notfound');
        }
      } catch {
        setPhase('notfound');
      } finally {
        resolvingRef.current = false;
      }
    },
    [services, stopCamera, recordActivity],
  );

  // ── camera lifecycle ────────────────────────────────────────────────────
  // Acquire the camera ONCE on mount and keep it warm across scan→resolve→scan
  // cycles (pause/resume below) so the browser doesn't re-request it between
  // customers — on iOS Safari that's what was re-prompting for permission every
  // time. The stream is only released when the scan screen unmounts.
  useEffect(() => {
    let cancelled = false;
    setCameraError(null);
    void (async () => {
      try {
        const handle = await startScanner(SCAN_REGION_ID, (text) => void resolve(text));
        if (cancelled) {
          await handle.stop();
          return;
        }
        scannerRef.current = handle;
      } catch {
        if (!cancelled) {
          setCameraError(
            'Camera unavailable. On a phone, allow camera access, or type the customer’s card code below.',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      void stopCamera();
    };
    // `resolve`/`stopCamera` are stable useCallbacks — acquire only once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pause decoding off the scan step, resume on it — without releasing the stream.
  useEffect(() => {
    const handle = scannerRef.current;
    if (!handle) return;
    if (phase === 'scanning') handle.resume();
    else handle.pause();
  }, [phase]);

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
  const addCount = Math.min(points, sliderMax);

  /** Most recent non-reversal entry (the candidate for "undo last entry"). */
  const lastEntry = state
    ? [...state.transactions].reverse().find((t) => t.type !== 'reversal')
    : undefined;

  const scanNext = () => {
    recordActivity();
    setState(null);
    setActionError(null);
    setManual('');
    setPhase('scanning');
  };

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (manual.trim()) void resolveCode(manual);
  };

  // ── best-effort wallet push (never blocks the UI) ───────────────────────
  const pushWallet = (
    customerId: string,
    derived: { balance: number; rewardAvailable: boolean },
  ) => {
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
      const added = addCount;
      await services.loyalty.accrue(actor, state.customer.id, added);
      const next = await refresh(state.customer.id);
      if (next) {
        pushWallet(next.customer.id, {
          balance: next.balance,
          rewardAvailable: next.rewardAvailable,
        });
        const name = next.customer.displayName?.trim() || 'Member';
        toast.show(
          `Added ${added} · ${name} now at ${next.progress.current} / ${next.progress.threshold}`,
        );
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
        toast.show(
          `Reward redeemed · ${name} now at ${next.progress.current} / ${next.progress.threshold}`,
        );
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
        toast.show('Last entry undone');
      }
    } catch {
      setActionError('Could not undo that entry. It may have already been reversed.');
    } finally {
      setBusy(false);
    }
  };

  const backToPanel = () => {
    recordActivity();
    void stopCamera();
    navigate(ROUTES.staff);
  };

  return (
    <div className="screen bg-cream staff-scan">
      <TopBar role={actor.role === 'admin' ? 'Admin' : 'Counter'} />
      <div className="screen-pad staff-scan__body">
        <StateLabel>
          {phase === 'resolved'
            ? 'state · resolved'
            : phase === 'notfound'
              ? 'state · card not registered'
              : 'state · scanning'}
        </StateLabel>

        {/* Camera frame stays mounted across phases so the stream isn't
            re-acquired (no repeat iOS permission prompt). Hidden off the scan step. */}
        <div className={phase === 'scanning' ? undefined : 'staff-scan__camhide'} aria-hidden={phase !== 'scanning'}>
          <ScanView
            caption="Point at the customer’s code"
            videoSlot={<div id={SCAN_REGION_ID} className="staff-scan__region" />}
          />
        </div>

        {phase === 'scanning' && (
          <>
            {cameraError && <p className="staff-scan__error">{cameraError}</p>}
            <form className="staff-scan__manual" onSubmit={submitManual}>
              <label>
                Card code
                <input
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  placeholder="e.g. K39X-Q4T7"
                  autoComplete="off"
                  autoCapitalize="characters"
                  inputMode="text"
                />
              </label>
              <Button variant="line" type="submit" disabled={!manual.trim()}>
                Look up
              </Button>
            </form>
            <div className="spacer" />
            <Button variant="ghost" className="staff-scan__ghost" onClick={backToPanel}>
              Back
            </Button>
          </>
        )}

        {phase === 'notfound' && (
          <>
            <div className="cust">
              <span className="av">?</span>
              <div>
                <div className="cn">Not a registered card</div>
                <div className="cs">No card matches that code</div>
              </div>
            </div>
            <p className="staff-scan__hint">
              Ask the customer to join on their own phone first — tap “Join the club” on the
              welcome screen — then scan their card.
            </p>
            <div className="stack-sm staff-scan__actions">
              <Button variant="forest" onClick={scanNext} disabled={busy}>
                Scan next
              </Button>
              <Button
                variant="ghost"
                className="staff-scan__ghost"
                onClick={backToPanel}
                disabled={busy}
              >
                Back
              </Button>
            </div>
          </>
        )}

        {phase === 'resolved' && state && (
          <>
            <CustChip
              name={customerName}
              current={filled}
              total={threshold}
              status="scanned"
            />

            <div className="staff-scan__gap" aria-hidden="true" />

            <PointsSlider
              value={points}
              onChange={setPoints}
              max={sliderMax}
              label="Coffees to add"
            />

            {actionError && <p className="staff-scan__error">{actionError}</p>}

            <div className="stack-sm staff-scan__actions">
              <Button variant="forest" onClick={() => void onAdd()} disabled={busy}>
                {coffeeLabel(addCount)}
              </Button>

              <Button
                variant="line"
                onClick={() => void onRedeem()}
                disabled={busy || !rewardReady}
              >
                Redeem reward
              </Button>
              {!rewardReady && (
                <p className="elig">
                  Unlocks at {threshold} cups — {toGo} to go.
                </p>
              )}

              <Button
                variant="ghost"
                className="staff-scan__ghost"
                onClick={() => void onUndo()}
                disabled={busy || !lastEntry}
              >
                Undo last entry
              </Button>
              <Button
                variant="ghost"
                className="staff-scan__ghost"
                onClick={scanNext}
                disabled={busy}
              >
                Scan next
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
