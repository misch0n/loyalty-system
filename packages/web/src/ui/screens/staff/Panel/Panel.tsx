/**
 * Staff panel (Ckyka view 09) — the idle landing a trusted device boots into.
 * Camera is closed here.
 *
 * Header: the forest `<TopBar>` (gesture-bearing mark + "Counter" pill) with an
 * `.onshift` line showing the signed-in staff name. Primary action: a forest
 * "Scan a customer's code" button → the scan workflow. Below: "Recent on this
 * terminal" — the loyalty.* audit feed, resolved to staff NAMES + target
 * customer names (read-only; never written to the log). Footer: a discreet
 * "End shift / switch staff" ghost button → logout → sign-in.
 *
 * UI → services only. Reads via `services.audit/staff/customers`; the session
 * via `useAuth`; the feed refetches on the prototype pairing `dataVersion`.
 * Reuses the old StaffPanel + activity.ts wiring, restyled to the reference.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../../components/Button/Button';
import { useAuth } from '../../../app/AuthContext';
import { ROUTES } from '../../../app/routes';
import { useServices } from '../../../common/ServicesContext';
import { usePairing } from '../../../common/PairingContext';
import { TopBar, OnShift } from '../_parts';
import { useStaffGuard } from '../useStaffGuard';
import { actionLabel, isLoyaltyAction, relativeTime } from '../activity';
import './Panel.css';

/**
 * Appendix E — "recent and local". The counter's activity list is bounded to the
 * SIGNED-IN actor's own actions in the LAST HOUR, hard-capped at this many rows,
 * with no pager and no "Load all": the bound IS the safeguard. A terminal is for
 * catching a mistake you just made, not for browsing the shop's history — that
 * lives behind the admin export workflow. Actor+time scoping also means a
 * logout/login still only ever shows that staffer's own last hour.
 */
const RECENT_CAP = 10;
const RECENT_WINDOW_MS = 60 * 60 * 1000;

/** True when an ISO timestamp falls inside the trailing one-hour window. */
function withinWindow(iso: string): boolean {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return false;
  return Date.now() - then <= RECENT_WINDOW_MS;
}

interface ActivityItem {
  id: string;
  action: string;
  kind: 'add' | 'red';
  customerName?: string;
  timestamp: string;
}

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
  </svg>
);

const StarIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2l2.4 6.3L21 9l-5 4.2L17.6 20 12 16.4 6.4 20 8 13.2 3 9l6.6-.7z" />
  </svg>
);

export function Panel(): JSX.Element {
  const guard = useStaffGuard();
  const services = useServices();
  const navigate = useNavigate();
  const { logout, recordActivity } = useAuth();
  const { dataVersion } = usePairing();

  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [recentOpen, setRecentOpen] = useState(true);

  const actorId = guard.actor?.id;

  const loadActivity = useCallback(async () => {
    if (!actorId) return [];
    // Scoped to THIS actor (newest first), then trimmed to the last hour and
    // capped — see RECENT_CAP. No pager: there is deliberately no way to widen it.
    const entries = await services.audit.list({ actorId });
    const loyalty = entries
      .filter((e) => isLoyaltyAction(e.action) && withinWindow(e.timestamp))
      .slice(0, RECENT_CAP);

    // Resolve customer names for targets (read-only; never written to the log).
    const customerNames = new Map<string, string>();
    await Promise.all(
      [...new Set(loyalty.map((e) => e.targetId).filter((id): id is string => Boolean(id)))].map(
        async (id) => {
          const customer = await services.customers.getById(id);
          if (customer?.displayName) customerNames.set(id, customer.displayName);
        },
      ),
    );

    return loyalty.map<ActivityItem>((e) => ({
      id: e.id,
      action: actionLabel(e.action, e.details),
      kind: e.action === 'loyalty.redeem' ? 'red' : 'add',
      customerName: e.targetId ? customerNames.get(e.targetId) : undefined,
      timestamp: e.timestamp,
    }));
  }, [services, actorId]);

  useEffect(() => {
    if (!actorId) return;
    let cancelled = false;
    void loadActivity()
      .then((rows) => {
        if (!cancelled) {
          setItems(rows);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [actorId, loadActivity, dataVersion]);

  if (guard.redirect) return guard.redirect;
  const actor = guard.actor;

  const onScan = () => {
    recordActivity();
    navigate(ROUTES.staffScan);
  };

  const onSignOut = () => {
    logout();
    navigate(ROUTES.login, { replace: true });
  };

  return (
    <div className="screen bg-cream staff-panel">
      <TopBar
        role={actor.role === 'admin' ? 'Admin' : 'Counter'}
        action={
          actor.role === 'admin' ? (
            <button type="button" className="topbar-go" onClick={() => navigate(ROUTES.admin)}>
              Go to admin
            </button>
          ) : undefined
        }
      />
      <div className="screen-pad staff-panel__body">
        <OnShift name={actor.name ?? actor.username} />

        <Button variant="forest" className="staff-panel__scan" onClick={onScan}>
          Scan a customer’s code
        </Button>

        <button
          type="button"
          className="staff-panel__recent-h"
          aria-expanded={recentOpen}
          onClick={() => setRecentOpen((o) => !o)}
        >
          <span className="section-h">Your last hour</span>
          <span className="staff-panel__chev" aria-hidden="true">
            {recentOpen ? '⌄' : '›'}
          </span>
        </button>
        {recentOpen &&
          (!loaded ? (
            <p className="staff-panel__empty">Loading…</p>
          ) : items.length === 0 ? (
            <p className="staff-panel__empty">
              Nothing in the last hour. Scan a customer’s code to add their first coffee.
            </p>
          ) : (
            <div className="feed">
              {items.map((item) => (
                <div key={item.id} className={`row ${item.kind}`}>
                  <span className="ri">{item.kind === 'red' ? <StarIcon /> : <PlusIcon />}</span>
                  <div className="rt">
                    {capitalize(item.action)}
                    {item.customerName ? <span> · {item.customerName}</span> : null}
                  </div>
                  <span className="rtime">{relativeTime(item.timestamp)}</span>
                </div>
              ))}
            </div>
          ))}

        <div className="spacer" />
        <Button variant="ghost" className="staff-panel__signout" onClick={onSignOut}>
          End shift / switch staff
        </Button>
      </div>
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
