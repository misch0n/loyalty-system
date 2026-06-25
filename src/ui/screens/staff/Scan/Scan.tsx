/**
 * Staff scan workflow (Ckyka view 10) — one screen, sequenced states (not
 * separate routes), reworked for rewards-as-objects (REWARDS-PLAN Phase 5):
 *   scanning   — live camera inside the `<ScanView>` frame; decode → resolve
 *   resolved   — camera collapses; `<CustChip>` confirms WHO, then the UNIFIED
 *                counter: a points slider AND a reward checklist (pre-checked
 *                from the scan), committed together in ONE atomic call
 *   committed  — confirmation + a 5-second Undo affordance, then "Scan next"
 *   notfound   — unknown code → "have them join on their phone" hint
 *
 * Every commit/undo is staff-initiated, passes the authenticated `actor`, and is
 * append-only (undo reverses points, voids a fresh mint, and re-mints a
 * replacement per spent reward — never a destructive edit). A scan resolves a
 * uniform `{customerToken, rewardTokens, source}` (`parseScan`); the customer's
 * unspent rewards drive the checklist and any scanned reward token that no longer
 * matches an unspent reward is surfaced as "already used". UI → services only.
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
import { parseScan, type ScanResult } from '../../../../qr/encode';
import { generateId, normalizeShortCode, formatShortCode } from '../../../../domain/tokens';
import type { CustomerState, CommitResult } from '../../../../services/LoyaltyService';
import './Scan.css';

const SCAN_REGION_ID = 'staff-scan-region';
/** Hard ceiling on the multi-add slider regardless of config (Ckyka view 10). */
const SLIDER_HARD_CAP = 3;
/** How long the Undo affordance stays live after a commit (REWARDS-PLAN §2). */
const UNDO_WINDOW_MS = 5000;

type Phase = 'scanning' | 'resolved' | 'committed' | 'notfound';

/** A successful commit kept around for the confirmation + undo step. */
interface Committed {
  idempotencyKey: string;
  pointsAdded: number;
  result: Extract<CommitResult, { ok: true }>;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** Context-aware label for the single commit button. */
function commitLabel(points: number, redeemCount: number): string {
  const add = points > 0 ? `Add ${points} ${plural(points, 'coffee', 'coffees')}` : '';
  const redeem = redeemCount > 0 ? `Redeem ${redeemCount}` : '';
  if (add && redeem) return `${add} · ${redeem}`;
  return add || redeem || 'Add coffees';
}

export function Scan(): JSX.Element {
  const guard = useStaffGuard();
  const services = useServices();
  const navigate = useNavigate();
  const toast = useToast();
  const { recordActivity } = useAuth();

  const [phase, setPhase] = useState<Phase>('scanning');
  const [state, setState] = useState<CustomerState | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [invalidRewards, setInvalidRewards] = useState<string[]>([]);
  const [points, setPoints] = useState(1);
  const [busy, setBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [committed, setCommitted] = useState<Committed | null>(null);
  const [canUndo, setCanUndo] = useState(false);

  const scannerRef = useRef<ScannerHandle | null>(null);
  const resolvingRef = useRef(false);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopCamera = useCallback(async () => {
    const handle = scannerRef.current;
    scannerRef.current = null;
    if (handle) await handle.stop();
  }, []);

  const clearUndoTimer = useCallback(() => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  }, []);

  /** Move into the resolved state for a freshly-fetched customer + scan. */
  const enterResolved = useCallback((next: CustomerState, parsed: ScanResult) => {
    const unspent = next.rewards ?? [];
    const scannedTokens = new Set(parsed.rewardTokens);
    const ownedTokens = new Set(unspent.map((r) => r.token));
    const preChecked: Record<string, boolean> = {};
    for (const reward of unspent) preChecked[reward.id] = scannedTokens.has(reward.token);
    setState(next);
    setScan(parsed);
    setChecked(preChecked);
    setInvalidRewards(parsed.rewardTokens.filter((t) => !ownedTokens.has(t)));
    // A reward scan is redeem-focused (default 0 points); a plain card scan
    // defaults to one coffee for the current purchase.
    setPoints(parsed.kind === 'reward' && parsed.rewardTokens.length > 0 ? 0 : 1);
    setPhase('resolved');
  }, []);

  // ── resolve a scanned code (card or reward QR) ──────────────────────────
  const resolve = useCallback(
    async (text: string) => {
      if (resolvingRef.current) return;
      resolvingRef.current = true;
      recordActivity();
      const parsed = parseScan(text);
      await stopCamera();
      setActionError(null);
      try {
        const found = await services.loyalty.getStateByToken(parsed.customerToken);
        if (!found) {
          setPhase('notfound');
          return;
        }
        const fresh = await services.loyalty.getState(found.customer.id);
        enterResolved(fresh, parsed);
      } catch {
        setPhase('notfound');
      } finally {
        resolvingRef.current = false;
      }
    },
    [services, stopCamera, recordActivity, enterResolved],
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
        const found = await services.loyalty.getStateByShortCode(code);
        if (!found) {
          setPhase('notfound');
          return;
        }
        const fresh = await services.loyalty.getState(found.customer.id);
        // Manual entry carries no reward tokens — the staffer ticks the list.
        enterResolved(fresh, {
          kind: 'card',
          customerToken: found.customer.token,
          rewardTokens: [],
          source: 'a',
        });
      } catch {
        setPhase('notfound');
      } finally {
        resolvingRef.current = false;
      }
    },
    [services, stopCamera, recordActivity, enterResolved],
  );

  // ── camera lifecycle (only while scanning) ──────────────────────────────
  useEffect(() => {
    if (phase !== 'scanning') return;
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
  }, [phase, resolve, stopCamera]);

  // Stop the camera / cancel the undo timer if the screen unmounts.
  useEffect(() => () => void stopCamera(), [stopCamera]);
  useEffect(() => () => clearUndoTimer(), [clearUndoTimer]);

  if (guard.redirect) return guard.redirect;
  const actor = guard.actor;

  // ── derived view helpers ────────────────────────────────────────────────
  const config = state?.config;
  const threshold = config?.pointsPerReward ?? 10;
  const balance = state?.balance ?? 0;
  const filled = state?.progress.current ?? 0;
  const rewards = state?.rewards ?? [];
  const sliderMax = Math.min(config?.maxPointsPerTransaction ?? SLIDER_HARD_CAP, SLIDER_HARD_CAP);
  const customerName = state?.customer.displayName?.trim() || 'Member';
  const redeemIds = rewards.filter((r) => checked[r.id]).map((r) => r.id);
  const redeemCount = redeemIds.length;
  const addCount = Math.min(points, sliderMax);
  const nothingToCommit = addCount === 0 && redeemCount === 0;

  // ── best-effort wallet push (never blocks the UI) ───────────────────────
  const pushWallet = (next: CustomerState) => {
    void services.wallet
      .pushUpdate(next.customer.id, {
        balance: next.balance,
        rewardCount: (next.rewards ?? []).length,
      })
      .catch(() => {
        // Free-tier prototype: no-op. Web card remains the source of truth.
      });
  };

  const scanNext = () => {
    recordActivity();
    clearUndoTimer();
    setState(null);
    setScan(null);
    setChecked({});
    setInvalidRewards([]);
    setCommitted(null);
    setCanUndo(false);
    setActionError(null);
    setManual('');
    setPhase('scanning');
  };

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (manual.trim()) void resolveCode(manual);
  };

  const toggleReward = (rewardId: string) => {
    recordActivity();
    setChecked((prev) => ({ ...prev, [rewardId]: !prev[rewardId] }));
  };

  // ── the single unified commit (accrue + mint + redeem-N) ────────────────
  const onCommit = async () => {
    if (!state || busy || nothingToCommit) return;
    setBusy(true);
    setActionError(null);
    recordActivity();
    const idempotencyKey = generateId();
    try {
      const result = await services.loyalty.commit(actor, {
        customerId: state.customer.id,
        pointsDelta: addCount,
        redeemRewardIds: redeemIds,
        idempotencyKey,
        source: scan?.source ?? 'a',
      });
      if (!result.ok) {
        setActionError(
          result.error === 'over_cap'
            ? `That’s over the ${sliderMax}-coffee limit for one scan.`
            : 'That card could not be found. Scan again.',
        );
        return;
      }
      setState(result.state);
      pushWallet(result.state);
      setCommitted({ idempotencyKey, pointsAdded: addCount, result });
      setCanUndo(true);
      clearUndoTimer();
      undoTimerRef.current = setTimeout(() => setCanUndo(false), UNDO_WINDOW_MS);
      setPhase('committed');
      toast.show(commitConfirmation(customerName, addCount, result));
    } catch {
      setActionError('Could not save. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  // ── undo the last commit within the 5-second window ─────────────────────
  const onUndo = async () => {
    if (!committed || busy) return;
    setBusy(true);
    setActionError(null);
    recordActivity();
    try {
      const result = await services.loyalty.undo(actor, committed.idempotencyKey);
      if (!result.ok) {
        setActionError('Could not undo that — it may already have been undone.');
        return;
      }
      clearUndoTimer();
      setCanUndo(false);
      pushWallet(result.state);
      // Drop back to the resolved card so the staffer can re-commit correctly.
      enterResolved(result.state, scan ?? {
        kind: 'card',
        customerToken: result.state.customer.token,
        rewardTokens: [],
        source: 'a',
      });
      toast.show(`Undone · ${customerName} back to ${result.state.progress.current} / ${threshold}`);
    } catch {
      setActionError('Could not undo. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const backToPanel = () => {
    recordActivity();
    clearUndoTimer();
    void stopCamera();
    navigate(ROUTES.staff);
  };

  return (
    <div className="screen bg-cream staff-scan">
      <TopBar role={actor.role === 'admin' ? 'Admin' : 'Counter'} />
      <div className="screen-pad staff-scan__body">
        {phase === 'scanning' && (
          <>
            <StateLabel>state · scanning</StateLabel>
            <ScanView
              caption="Point at the customer’s code"
              videoSlot={<div id={SCAN_REGION_ID} className="staff-scan__region" />}
            />
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
            <StateLabel>state · card not registered</StateLabel>
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
            <StateLabel>state · resolved</StateLabel>
            <CustChip name={customerName} current={filled} total={threshold} status="scanned" />

            <div className="staff-scan__gap" aria-hidden="true" />

            <PointsSlider
              value={points}
              onChange={setPoints}
              min={0}
              max={sliderMax}
              label="Coffees to add"
            />

            {rewards.length > 0 && (
              <fieldset className="staff-scan__rewards">
                <legend>Free coffees to redeem</legend>
                {rewards.map((reward) => (
                  <label key={reward.id} className="staff-scan__reward">
                    <input
                      type="checkbox"
                      checked={!!checked[reward.id]}
                      onChange={() => toggleReward(reward.id)}
                    />
                    <span className="staff-scan__reward-desc">{reward.descriptionSnapshot}</span>
                    <span className="staff-scan__reward-code">{formatShortCode(reward.shortCode)}</span>
                  </label>
                ))}
              </fieldset>
            )}

            {invalidRewards.length > 0 && (
              <p className="staff-scan__hint">
                {invalidRewards.length} scanned{' '}
                {plural(invalidRewards.length, 'reward was', 'rewards were')} already used.
              </p>
            )}

            {actionError && <p className="staff-scan__error">{actionError}</p>}

            <div className="stack-sm staff-scan__actions">
              <Button
                variant="forest"
                onClick={() => void onCommit()}
                disabled={busy || nothingToCommit}
              >
                {commitLabel(addCount, redeemCount)}
              </Button>
              {rewards.length === 0 && (
                <p className="elig">
                  No free coffees yet — {Math.max(0, threshold - balance)} to go.
                </p>
              )}
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

        {phase === 'committed' && committed && (
          <>
            <StateLabel>state · saved</StateLabel>
            <CustChip
              name={customerName}
              current={filled}
              total={threshold}
              status="saved"
            />
            <p className="staff-scan__saved">
              {commitConfirmation(customerName, committed.pointsAdded, committed.result)}
            </p>
            {committed.result.rejected.length > 0 && (
              <p className="staff-scan__hint">
                {committed.result.rejected.length}{' '}
                {plural(committed.result.rejected.length, 'reward was', 'rewards were')} already
                used and skipped.
              </p>
            )}

            {actionError && <p className="staff-scan__error">{actionError}</p>}

            <div className="stack-sm staff-scan__actions">
              {canUndo && (
                <Button variant="line" onClick={() => void onUndo()} disabled={busy}>
                  Undo
                </Button>
              )}
              <Button variant="forest" onClick={scanNext} disabled={busy}>
                Scan next
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** One-line confirmation of what a commit did (points / redeemed / minted). */
function commitConfirmation(
  name: string,
  pointsAdded: number,
  result: Extract<CommitResult, { ok: true }>,
): string {
  const parts: string[] = [];
  if (pointsAdded > 0) parts.push(`Added ${pointsAdded}`);
  if (result.redeemed.length > 0) parts.push(`redeemed ${result.redeemed.length}`);
  if (result.minted.length > 0) {
    parts.push(`${result.minted.length} new ${plural(result.minted.length, 'reward', 'rewards')}`);
  }
  const summary = parts.length > 0 ? parts.join(' · ') : 'No change';
  return `${name}: ${summary} · now ${result.state.progress.current} / ${result.state.progress.threshold}`;
}
