/**
 * Staff scan workflow (Ckyka view 10) — one screen, sequenced states (not
 * separate routes), reworked for the Appendix E pre-commit hold (INTEGRITY-PLAN
 * Phase 0):
 *   scanning   — live camera inside the `<ScanView>` frame; decode → resolve.
 *                The card-code field below it is the fallback for a blocked or
 *                missing camera
 *   resolved   — camera collapses; `<CustChip>` confirms WHO, then the UNIFIED
 *                counter: a points slider AND a reward checklist (pre-checked
 *                from the scan), staged together for ONE atomic call
 *   pending    — a 3-second blocking hold that summarizes exactly what is about
 *                to be written, with Cancel and Commit now. NOTHING is written
 *                until the window elapses
 *   unsent     — the commit did not get an answer (offline, server failure) or
 *                was refused for going too fast (`rate_limited`). The staged
 *                transaction is KEPT, idempotency key and all, with Try again
 *                (same key, no second hold) and Discard
 *   done       — the commit saved, but some of the rewards it named were
 *                refused (already used, another card's, no longer valid). Says
 *                what saved and which rewards did not, and stays put
 *   notfound   — no card matches that code → "check they've registered"
 *
 * Every failure the terminal can detect says what happened and what to do
 * (SCOPE-DECISIONS §2.4, UI-PLAN UI-4): an unreadable QR or a malformed typed
 * code makes no request; a lookup that FAILED (as opposed to finding nothing)
 * keeps scanning with the reason on screen; a commit that may or may not have
 * landed is never thrown away silently. Session failures are left to the
 * global handler (X2), which leaves this screen.
 *
 * The hold replaces the old post-commit Undo: errors are caught in the seconds
 * BEFORE the ledger is touched, so there is no staff-reachable path that
 * reverses an already-committed transaction. Cancel discards the staged
 * transaction and writes nothing. The idempotency key is allocated when the
 * transaction is staged, so an early "Commit now", the timeout and any number
 * of Try agains after a lost answer all write it at most once.
 *
 * After a successful commit the terminal returns to the **counter** (`/staff`,
 * the Panel) with a one-line toast of what was saved — not straight back to the
 * camera (register S2; triage Q6, FE-S-12). The counter is where the next
 * customer is started from, and its "your last hour" list now shows the commit
 * that was just made. "Scan next" on this screen is still the deliberate way to
 * go straight to another scan. A commit with refused rewards stays on `done`
 * instead, so the refusal is read before anyone hands over a free coffee.
 *
 * Every commit is staff-initiated, passes the authenticated `actor`, and is
 * append-only. A scan resolves a uniform `{customerToken, rewardTokens, source}`
 * (`parseScan`); the customer's unspent rewards drive the checklist and any
 * scanned reward token that no longer matches an unspent reward is surfaced as
 * "already used". UI → services only.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../../components/Button/Button';
import { PointsSlider } from '../../../components/Slider/Slider';
import { useToast } from '../../../components/Toast/Toast';
import { ROUTES } from '../../../app/routes';
import { useServices } from '../../../common/ServicesContext';
import {
  failureMessage,
  isConnectivityFailure,
  isSessionFailure,
  retryAfterOf,
} from '../../../common/failure';
import { formatWait, useRetryCountdown } from '../../../common/useRetryCountdown';
import { TopBar, ScanView, CustChip, StateLabel } from '../_parts';
import { useStaffGuard } from '../useStaffGuard';
import { startScanner, type ScannerHandle } from '../../../../qr/scan';
import { parseScan, type ScanResult } from '../../../../qr/encode';
import {
  generateId,
  normalizeShortCode,
  formatShortCode,
  isValidShortCode,
  isValidToken,
} from '@cafe/shared/domain/tokens';
import { mintFold } from '@cafe/shared/domain/rewards';
import { isApiError } from '../../../../services/errors';
import type { Actor } from '../../../../services/types';
import type { CommitResult, CustomerState } from '../../../../services/LoyaltyService';
import './Scan.css';

const SCAN_REGION_ID = 'staff-scan-region';
/** Hard ceiling on the multi-add slider regardless of config (Ckyka view 10). */
const SLIDER_HARD_CAP = 3;
/**
 * How long a staged transaction is held before it is written (Appendix E).
 * Nothing touches the store until this elapses — the hold IS the safeguard.
 */
const HOLD_MS = 3000;
/** Countdown repaint interval. */
const HOLD_TICK_MS = 100;
/**
 * After a lookup fails the camera comes back on, and the customer is usually
 * still holding the same code up to it. Ignore decodes for this long so a
 * failing lookup is retried at a walking pace, not at the camera's frame rate.
 */
const LOOKUP_PAUSE_MS = 3000;

// ── copy (SCOPE-DECISIONS §2.4: what happened, then what to do) ───────────
const UNREADABLE =
  'Couldn’t read that code. Hold it steady and try again, or type the card code below.';
const BAD_SHORT_CODE = 'A card code is 8 letters and numbers, like K39X-Q4T7.';
const CAMERA_BLOCKED =
  'Camera access is blocked. Allow it in this browser’s settings, or type the card code below.';
const CAMERA_UNAVAILABLE =
  'There’s no camera available on this device. Type the customer’s card code below.';
const LOOKUP_FALLBACK = 'Couldn’t look up that card. Try again.';
const LOOKUP_OVERRIDES = {
  offline: 'Couldn’t reach the till system. Check this device’s internet connection, then try again.',
  server: 'The till system had a problem just now. Try again in a moment.',
};
const COMMIT_UNSENT = {
  offline: 'Couldn’t reach the till system, so this may not have saved. Try again — it won’t be added twice.',
  server: 'The till system had a problem, so this may not have saved. Try again — it won’t be added twice.',
};
const COMMIT_UNKNOWN =
  'Something went wrong, so this may not have saved. Try again — it won’t be added twice.';
const COMMIT_RATE_LIMITED =
  'Too many saves in a row. This one was refused — wait for the countdown, then try again.';
const COMMIT_REFUSED = 'Couldn’t save that. Try again.';
const CARD_GONE = 'No card matches that code any more. Scan it again.';
const DISCARDED_MAY_HAVE_SAVED =
  'Discarded. If the first try did save, the customer’s card already shows it — scan it again to check before adding more.';

type Phase = 'scanning' | 'resolved' | 'pending' | 'unsent' | 'done' | 'notfound';

/**
 * A transaction staged by the counter panel and awaiting the hold. It exists
 * only in component state — nothing here has been written.
 */
interface Staged {
  /** Allocated up front so an early "Commit now", the timeout and every retry share one key. */
  idempotencyKey: string;
  pointsDelta: number;
  redeemRewardIds: string[];
  /** Rewards this WILL mint, computed client-side (nothing is committed yet). */
  willMint: number;
  source: 'a' | 'w';
}

/** Why a staged transaction is waiting on screen instead of being saved. */
interface Unsent {
  message: string;
  /** True once any attempt went unanswered — it may have landed. */
  mayHaveSaved: boolean;
}

/** A commit that saved but refused some of the rewards it named. */
interface Outcome {
  saved: string[];
  refused: string[];
}

type CommitOk = Extract<CommitResult, { ok: true }>;
type Reward = NonNullable<CustomerState['rewards']>[number];

const REFUSAL_REASON: Record<CommitOk['rejected'][number]['reason'], string> = {
  already_spent: 'already used',
  not_owner: 'not on this card',
  reward_invalid: 'no longer valid',
};

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

/**
 * A blocked camera (permission denied, or an insecure page) versus none at all.
 * `getUserMedia` rejects with a `DOMException` named `NotAllowedError`;
 * html5-qrcode sometimes re-wraps that into a string mentioning the permission.
 */
function cameraBlocked(err: unknown): boolean {
  const name =
    typeof err === 'object' && err !== null && 'name' in err
      ? String((err as { name: unknown }).name)
      : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return true;
  const text = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return /NotAllowedError|permission/i.test(text);
}

/** "Free coffee · ABCD-1234", or a neutral label when the reward is unknown. */
function rewardLabel(reward: Reward | undefined): string {
  if (!reward) return '1 free coffee';
  const code = formatShortCode(reward.shortCode);
  return code ? `${reward.descriptionSnapshot} · ${code}` : reward.descriptionSnapshot;
}

export function Scan(): JSX.Element {
  const guard = useStaffGuard();
  const services = useServices();
  const navigate = useNavigate();
  const toast = useToast();

  const [phase, setPhase] = useState<Phase>('scanning');
  const [state, setState] = useState<CustomerState | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [invalidRewards, setInvalidRewards] = useState<string[]>([]);
  const [points, setPoints] = useState(1);
  const [busy, setBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  /** An unreadable QR, or a camera lookup that failed. Shown under the camera. */
  const [scanError, setScanError] = useState<string | null>(null);
  /** A malformed typed code, or a typed lookup that failed. Shown on the field. */
  const [manualError, setManualError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** A neutral hint on the resolved counter (after Discard). */
  const [notice, setNotice] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [staged, setStaged] = useState<Staged | null>(null);
  const [unsent, setUnsent] = useState<Unsent | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [remainingMs, setRemainingMs] = useState(HOLD_MS);
  /** Bumped to restart the camera when a lookup fails while already `scanning`. */
  const [cameraRun, setCameraRun] = useState(0);

  const lookupWait = useRetryCountdown();
  const commitWait = useRetryCountdown();
  const startLookupWait = lookupWait.start;

  const scannerRef = useRef<ScannerHandle | null>(null);
  const manualRef = useRef<HTMLInputElement | null>(null);
  const resolvingRef = useRef(false);
  /** Camera decodes before this instant are ignored (see LOOKUP_PAUSE_MS). */
  const pauseUntilRef = useRef(0);
  /**
   * The hold's countdown effect must be declared before the staff guard's early
   * return, but the commit closure needs the authenticated actor that the guard
   * produces. Keep both behind latest-value refs the effect can read.
   */
  const actorRef = useRef<Actor | null>(null);
  const commitRef = useRef<((staged: Staged) => Promise<void>) | null>(null);
  /**
   * Guards the one-send-per-press rule: the hold's timeout and "Commit now"
   * cannot both send. Cleared only by a deliberate action (see runCommit).
   */
  const firedRef = useRef(false);
  /** A staffer who left while a commit was in flight is not pulled back to the counter. */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const stopCamera = useCallback(async () => {
    const handle = scannerRef.current;
    scannerRef.current = null;
    if (handle) await handle.stop();
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

  /**
   * Look a customer up and move on. "Not found" (`null`) is an answer and goes
   * to `notfound`; a THROW is a failure to ask — it stays on `scanning`, with
   * the camera restarted and the reason shown where the code came from.
   */
  const lookup = useCallback(
    async (
      origin: 'camera' | 'manual',
      find: () => Promise<CustomerState | null>,
      toScan: (found: CustomerState) => ScanResult,
    ) => {
      resolvingRef.current = true;
      await stopCamera();
      setActionError(null);
      setNotice(null);
      try {
        const found = await find();
        setScanError(null);
        setManualError(null);
        if (!found) {
          setPhase('notfound');
          return;
        }
        const fresh = await services.loyalty.getState(found.customer.id);
        enterResolved(fresh, toScan(found));
      } catch (err) {
        const wait = retryAfterOf(err);
        pauseUntilRef.current = Date.now() + Math.max(LOOKUP_PAUSE_MS, (wait ?? 0) * 1000);
        if (wait !== null) startLookupWait(wait);
        if (!isSessionFailure(err)) {
          const message = failureMessage(err, LOOKUP_FALLBACK, LOOKUP_OVERRIDES);
          if (origin === 'camera') {
            setScanError(message);
          } else {
            setScanError(null);
            setManualError(message);
          }
        }
        // Still `scanning`, so the camera effect will not re-run by itself.
        setCameraRun((n) => n + 1);
      } finally {
        resolvingRef.current = false;
      }
    },
    [services, stopCamera, enterResolved, startLookupWait],
  );

  // ── resolve a scanned code (card or reward QR) ──────────────────────────
  const resolve = useCallback(
    async (text: string) => {
      if (resolvingRef.current || Date.now() < pauseUntilRef.current) return;
      let parsed: ScanResult;
      try {
        parsed = parseScan(text);
      } catch {
        setScanError(UNREADABLE);
        return;
      }
      // Not one of ours (or damaged): no request, camera stays on.
      if (!isValidToken(parsed.customerToken)) {
        setScanError(UNREADABLE);
        return;
      }
      await lookup(
        'camera',
        () => services.loyalty.getStateByToken(parsed.customerToken),
        () => parsed,
      );
    },
    [services, lookup],
  );

  // ── resolve a typed SHORT CODE (camera-fail fallback) ───────────────────
  const resolveCode = useCallback(
    async (code: string) => {
      if (resolvingRef.current) return;
      // Manual entry carries no reward tokens — the staffer ticks the list.
      await lookup(
        'manual',
        () => services.loyalty.getStateByShortCode(code),
        (found) => ({
          kind: 'card',
          customerToken: found.customer.token,
          rewardTokens: [],
          source: 'a',
        }),
      );
    },
    [services, lookup],
  );

  // ── camera lifecycle (only while scanning, and only once the screen shows) ─
  // The guard renders "Loading…" until the boot check settles; starting the
  // scanner then would find no region to draw into and read as "no camera".
  const guardOpen = guard.redirect === null;
  useEffect(() => {
    if (phase !== 'scanning' || !guardOpen) return;
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
      } catch (err) {
        if (!cancelled) {
          setCameraError(cameraBlocked(err) ? CAMERA_BLOCKED : CAMERA_UNAVAILABLE);
          // Both point at the card-code field — put the cursor there.
          manualRef.current?.focus();
        }
      }
    })();
    return () => {
      cancelled = true;
      void stopCamera();
    };
  }, [phase, guardOpen, cameraRun, resolve, stopCamera]);

  // Keep the guard's actor readable from the countdown effect's closure.
  useEffect(() => {
    actorRef.current = guard.actor;
  });

  // ── the 3-second pre-commit hold ────────────────────────────────────────
  // Nothing is written while this runs. On timeout the staged transaction is
  // committed exactly once; Cancel tears the effect down before it fires.
  useEffect(() => {
    if (phase !== 'pending' || !staged) return;
    const deadline = Date.now() + HOLD_MS;
    setRemainingMs(HOLD_MS);
    const timer = setInterval(() => {
      const left = deadline - Date.now();
      if (left > 0) {
        setRemainingMs(left);
        return;
      }
      clearInterval(timer);
      setRemainingMs(0);
      void commitRef.current?.(staged);
    }, HOLD_TICK_MS);
    return () => clearInterval(timer);
  }, [phase, staged]);

  // Stop the camera if the screen unmounts.
  useEffect(() => () => void stopCamera(), [stopCamera]);

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
  const holdSecondsLeft = Math.max(1, Math.ceil(remainingMs / 1000));
  const holdProgress = Math.min(1, Math.max(0, 1 - remainingMs / HOLD_MS));

  /** Back to the camera, keeping whatever is typed in the card-code field. */
  const scanAgain = () => {
    firedRef.current = false;
    setState(null);
    setScan(null);
    setChecked({});
    setInvalidRewards([]);
    setStaged(null);
    setUnsent(null);
    setOutcome(null);
    setActionError(null);
    setNotice(null);
    setScanError(null);
    setManualError(null);
    setPhase('scanning');
  };

  const scanNext = () => {
    scanAgain();
    setManual('');
  };

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manual.trim() || lookupWait.waiting) return;
    const code = normalizeShortCode(manual);
    if (!isValidShortCode(code)) {
      setManualError(BAD_SHORT_CODE);
      manualRef.current?.focus();
      return;
    }
    void resolveCode(code);
  };

  const toggleReward = (rewardId: string) => {
    setChecked((prev) => ({ ...prev, [rewardId]: !prev[rewardId] }));
  };

  // ── stage the transaction and start the hold (writes NOTHING) ───────────
  const onStage = () => {
    // A rate-limit countdown (from a send that was refused, then discarded)
    // blocks staging anew: the server would refuse it the same way.
    if (!state || busy || nothingToCommit || commitWait.waiting) return;
    setActionError(null);
    setNotice(null);
    firedRef.current = false;
    // Preview the mint client-side — the store does the real fold on commit.
    const willMint = config ? mintFold(balance + addCount, config).mintCount : 0;
    setStaged({
      idempotencyKey: generateId(),
      pointsDelta: addCount,
      redeemRewardIds: redeemIds,
      willMint,
      source: scan?.source ?? 'a',
    });
    setRemainingMs(HOLD_MS);
    setPhase('pending');
  };

  /** Discard the staged transaction — nothing was ever written. */
  const onCancelHold = () => {
    // Too late once a send is in flight ("Commit now", or the timeout): its
    // answer decides the next state, and clearing `staged` under it would
    // leave `unsent` with nothing to show.
    if (firedRef.current) return;
    setStaged(null);
    setRemainingMs(HOLD_MS);
    setPhase('resolved');
  };

  /** Drop a transaction that went unanswered. It may have saved; say so. */
  const onDiscardUnsent = () => {
    firedRef.current = false;
    setNotice(unsent?.mayHaveSaved ? DISCARDED_MAY_HAVE_SAVED : null);
    setStaged(null);
    setUnsent(null);
    setPhase('resolved');
  };

  /** Re-send the SAME staged transaction, same key, straight away. */
  const onRetryUnsent = () => {
    if (!staged || busy || commitWait.waiting) return;
    firedRef.current = false;
    void runCommit(staged);
  };

  /**
   * `over_cap` means the server's limit is lower than the one this screen was
   * showing (the slider never goes past what it was told). Re-read the card so
   * the copy names the real limit and the slider follows it.
   */
  const overCapMessage = async (attempted: number, customerId: string): Promise<string> => {
    try {
      const fresh = await services.loyalty.getState(customerId);
      const cap = fresh.config.maxPointsPerTransaction;
      setState(fresh);
      setPoints((p) => Math.min(p, cap));
      return `You tried to add ${attempted} — the limit is ${cap} per scan.`;
    } catch {
      return `You tried to add ${attempted} — that’s over the limit for one scan.`;
    }
  };

  /** A saved commit that refused some rewards: say what saved and what didn't. */
  const describeOutcome = (pending: Staged, result: CommitOk): Outcome => {
    const known = new Map<string, Reward>();
    for (const r of [...rewards, ...(result.state.rewards ?? [])]) known.set(r.id, r);
    const saved: string[] = [];
    if (pending.pointsDelta > 0) {
      saved.push(`Added ${pending.pointsDelta} ${plural(pending.pointsDelta, 'coffee', 'coffees')}`);
    }
    if (result.redeemed.length > 0) {
      const n = result.redeemed.length;
      saved.push(`Redeemed ${n} free ${plural(n, 'coffee', 'coffees')}`);
    }
    if (result.minted.length > 0) {
      const n = result.minted.length;
      saved.push(`${customerName} earned ${n} free ${plural(n, 'coffee', 'coffees')}`);
    }
    const refused = result.rejected.map(
      (r) => `${rewardLabel(known.get(r.rewardId))} — ${REFUSAL_REASON[r.reason]}`,
    );
    return { saved, refused };
  };

  // ── the single unified commit (accrue + mint + redeem-N) ────────────────
  const runCommit = async (pending: Staged) => {
    if (!state || firedRef.current) return;
    firedRef.current = true;
    /** True when an earlier send of THIS staged transaction went unanswered. */
    const mayHaveSaved = unsent?.mayHaveSaved ?? false;
    setBusy(true);
    setActionError(null);
    try {
      const result = await services.loyalty.commit(actor, {
        customerId: state.customer.id,
        pointsDelta: pending.pointsDelta,
        redeemRewardIds: pending.redeemRewardIds,
        idempotencyKey: pending.idempotencyKey,
        source: pending.source,
      });
      if (!result.ok) {
        // Refused as a value: nothing was written by THIS send. Leave the hold
        // first, so its timer is gone before the (awaited) over-cap re-read.
        setNotice(mayHaveSaved ? DISCARDED_MAY_HAVE_SAVED : null);
        setStaged(null);
        setUnsent(null);
        setPhase('resolved');
        setActionError(
          result.error === 'over_cap'
            ? await overCapMessage(pending.pointsDelta, state.customer.id)
            : CARD_GONE,
        );
        return;
      }
      if (result.rejected.length > 0) {
        // Saved, but not all of it. Stay, so the refusal is read (no toast).
        setOutcome(describeOutcome(pending, result));
        setState(result.state);
        setStaged(null);
        setUnsent(null);
        setPhase('done');
        return;
      }
      // The toast is app-level, so it outlives this screen. S2: back to the
      // counter, not the camera — no card lingers on screen either way.
      toast.show(commitConfirmation(customerName, pending.pointsDelta, result));
      // Replace, so Back from the counter does not reopen a finished scan.
      if (mountedRef.current) navigate(ROUTES.staff, { replace: true });
    } catch (err) {
      // firedRef stays set: a hold timer still ticking after "Commit now" must
      // not fire a second send. Only a deliberate action (Try again, staging
      // anew, Cancel, Discard, Scan next) clears it.
      const wait = retryAfterOf(err);
      if (wait !== null) {
        // Refused before anything was written; keep it staged for the countdown.
        commitWait.start(wait);
        setUnsent({ message: COMMIT_RATE_LIMITED, mayHaveSaved });
        setPhase('unsent');
      } else if (!isApiError(err) || isConnectivityFailure(err)) {
        // No answer: it may have landed. Keep the staged transaction and its
        // key — a retry with the same key cannot write it twice.
        setUnsent({
          message: failureMessage(err, COMMIT_UNKNOWN, COMMIT_UNSENT),
          mayHaveSaved: true,
        });
        setPhase('unsent');
      } else {
        // Refused (not_found, forbidden, conflict…): nothing was written by
        // THIS send. But an earlier, unanswered one may have landed — a 403
        // (csrf, origin) is checked before the idempotency replay, so the
        // refusal says nothing about it. Drop the staged transaction (a retry
        // would be refused the same way until a reload, which loses it anyway)
        // and say how to check before anyone adds it again.
        setNotice(mayHaveSaved ? DISCARDED_MAY_HAVE_SAVED : null);
        setStaged(null);
        setUnsent(null);
        setPhase('resolved');
        if (!isSessionFailure(err)) setActionError(failureMessage(err, COMMIT_REFUSED));
      }
    } finally {
      setBusy(false);
    }
  };
  commitRef.current = runCommit;

  const backToPanel = () => {
    void stopCamera();
    navigate(ROUTES.staff);
  };

  const stagedList = (pending: Staged) => (
    <ul className="staff-scan__hold-list">
      {pending.pointsDelta > 0 && (
        <li>
          Add {pending.pointsDelta} {plural(pending.pointsDelta, 'coffee', 'coffees')}
        </li>
      )}
      {pending.redeemRewardIds.length > 0 && (
        <li>
          Redeem {pending.redeemRewardIds.length} free{' '}
          {plural(pending.redeemRewardIds.length, 'coffee', 'coffees')}
        </li>
      )}
      {pending.willMint > 0 && (
        <li className="staff-scan__hold-earn">
          {customerName} earns {pending.willMint} free{' '}
          {plural(pending.willMint, 'coffee', 'coffees')}
        </li>
      )}
    </ul>
  );

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
            {cameraError && (
              <p className="staff-scan__error staff-scan__camera-error" role="alert">
                {cameraError}
              </p>
            )}
            {scanError && (
              <p className="staff-scan__error staff-scan__scan-error" role="alert">
                {scanError}
              </p>
            )}
            <form className="staff-scan__manual" onSubmit={submitManual} noValidate>
              <label>
                Card code
                <input
                  ref={manualRef}
                  value={manual}
                  onChange={(e) => {
                    setManual(e.target.value);
                    setManualError(null);
                  }}
                  placeholder="e.g. K39X-Q4T7"
                  autoComplete="off"
                  autoCapitalize="characters"
                  inputMode="text"
                  aria-invalid={manualError ? true : undefined}
                  aria-describedby={manualError ? 'staff-scan-manual-error' : undefined}
                />
              </label>
              {manualError && (
                <p
                  id="staff-scan-manual-error"
                  className="staff-scan__error staff-scan__field-error"
                  role="alert"
                >
                  {manualError}
                </p>
              )}
              <Button
                variant="line"
                type="submit"
                disabled={!manual.trim() || lookupWait.waiting}
              >
                {lookupWait.waiting ? `Look up in ${formatWait(lookupWait.secondsLeft)}` : 'Look up'}
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
                <div className="cn">No card matches that code</div>
                <div className="cs">Not a registered card</div>
              </div>
            </div>
            <p className="staff-scan__hint">
              Ask the customer to check they’ve registered — their card opens on their own
              phone. If they haven’t joined yet, they can tap “Join the club” on the welcome
              screen, then you scan their card.
            </p>
            <div className="stack-sm staff-scan__actions">
              <Button variant="forest" onClick={scanAgain} disabled={busy}>
                Scan again
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

            {notice && <p className="staff-scan__hint staff-scan__notice">{notice}</p>}
            {actionError && (
              <p className="staff-scan__error" role="alert">
                {actionError}
              </p>
            )}

            <div className="stack-sm staff-scan__actions">
              <Button
                variant="forest"
                onClick={onStage}
                disabled={busy || nothingToCommit || commitWait.waiting}
              >
                {commitWait.waiting
                  ? `${commitLabel(addCount, redeemCount)} — wait ${formatWait(commitWait.secondsLeft)}`
                  : commitLabel(addCount, redeemCount)}
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

        {phase === 'pending' && staged && state && (
          <>
            <StateLabel>state · holding</StateLabel>
            <CustChip name={customerName} current={filled} total={threshold} status="holding" />

            <div className="staff-scan__hold" role="status" aria-live="polite">
              <p className="staff-scan__hold-lead">About to save</p>
              {stagedList(staged)}
              <div className="staff-scan__hold-bar" aria-hidden="true">
                <span style={{ transform: `scaleX(${holdProgress})` }} />
              </div>
              <p className="staff-scan__hold-count">
                Saving in {holdSecondsLeft}
                {' '}s — cancel now if this is wrong
              </p>
            </div>

            <div className="stack-sm staff-scan__actions">
              <Button variant="line" onClick={onCancelHold} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="forest"
                onClick={() => void runCommit(staged)}
                disabled={busy}
              >
                Commit now
              </Button>
            </div>
          </>
        )}

        {phase === 'unsent' && staged && unsent && state && (
          <>
            <StateLabel>state · not sent</StateLabel>
            <CustChip name={customerName} current={filled} total={threshold} status="not sent" />

            <div className="staff-scan__hold staff-scan__unsent">
              <p className="staff-scan__hold-lead">Waiting to save</p>
              {stagedList(staged)}
              <p className="staff-scan__error" role="alert">
                {unsent.message}
              </p>
            </div>

            <div className="stack-sm staff-scan__actions">
              <Button
                variant="forest"
                onClick={onRetryUnsent}
                disabled={busy || commitWait.waiting}
              >
                {busy
                  ? 'Trying again…'
                  : commitWait.waiting
                    ? `Try again in ${formatWait(commitWait.secondsLeft)}`
                    : 'Try again'}
              </Button>
              <Button variant="line" onClick={onDiscardUnsent} disabled={busy}>
                Discard
              </Button>
            </div>
          </>
        )}

        {phase === 'done' && outcome && state && (
          <>
            <StateLabel>state · saved with refusals</StateLabel>
            <CustChip
              name={customerName}
              current={state.progress.current}
              total={state.progress.threshold}
              status="saved"
            />

            <div className="staff-scan__hold staff-scan__result" role="status">
              {outcome.saved.length > 0 ? (
                <>
                  <p className="staff-scan__hold-lead">Saved</p>
                  <ul className="staff-scan__hold-list staff-scan__saved-list">
                    {outcome.saved.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="staff-scan__saved">Nothing was saved.</p>
              )}
              <p className="staff-scan__hold-lead staff-scan__refused-lead">Not redeemed</p>
              <ul className="staff-scan__hold-list staff-scan__refused">
                {outcome.refused.map((line, i) => (
                  <li key={`${i}-${line}`}>{line}</li>
                ))}
              </ul>
              <p className="staff-scan__hint">
                Don’t hand over a free coffee for {plural(outcome.refused.length, 'this one', 'these')}.
                {outcome.saved.length > 0 ? ' Everything else above was saved.' : ''}
              </p>
            </div>

            <div className="stack-sm staff-scan__actions">
              <Button variant="forest" onClick={() => navigate(ROUTES.staff, { replace: true })}>
                Back to counter
              </Button>
              <Button variant="line" onClick={scanNext}>
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
  result: {
    state: CustomerState;
    minted: readonly unknown[];
    redeemed: readonly unknown[];
  },
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
