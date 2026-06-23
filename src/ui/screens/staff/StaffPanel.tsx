/**
 * StaffPanel — idle landing for a signed-in staff terminal (UI-SPEC §4.8,
 * UX-SPEC §6/§7). The camera is closed here; this is the resting state a
 * trusted device boots into.
 *
 * Header: brand + role pill + who's on shift (the signed-in staff name).
 * Primary action: Scan (forest) → the scan workflow. Below: a short recent
 * activity list for context (loyalty.* audit entries, attributed to staff
 * NAMES), and a discreet sign-out / switch-staff affordance.
 *
 * UI → services only. Reads go through `services.audit`, `services.staff`, and
 * `services.customers`; the session comes from `useAuth`. Activity refetches
 * live on the prototype pairing `dataVersion`.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, ActivityRow, StatusPill, Eyebrow } from '../../kit';
import { useAuth } from '../../app/AuthContext';
import { ROUTES } from '../../app/routes';
import { useServices } from '../../common/ServicesContext';
import { usePairing } from '../../common/PairingContext';
import { useStaffGuard } from './useStaffGuard';
import { actionLabel, isLoyaltyAction, relativeTime } from './activity';
import './staff.css';

const ACTIVITY_LIMIT = 8;

interface ActivityItem {
  id: string;
  staffName: string;
  action: string;
  customerName?: string;
  timestamp: string;
}

export function StaffPanel(): JSX.Element {
  const guard = useStaffGuard();
  const services = useServices();
  const navigate = useNavigate();
  const { logout, recordActivity } = useAuth();
  const { dataVersion } = usePairing();

  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const actorId = guard.actor?.id;

  const loadActivity = useCallback(async () => {
    const [entries, staff] = await Promise.all([
      services.audit.list({ limit: ACTIVITY_LIMIT * 3 }),
      services.staff.list(),
    ]);
    const nameById = new Map(staff.map((s) => [s.id, s.username]));
    const loyalty = entries.filter((e) => isLoyaltyAction(e.action)).slice(0, ACTIVITY_LIMIT);

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
      staffName: nameById.get(e.actorId) ?? 'Staff',
      action: actionLabel(e.action, e.details),
      customerName: e.targetId ? customerNames.get(e.targetId) : undefined,
      timestamp: e.timestamp,
    }));
  }, [services]);

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
    <div className="staff-screen">
      <div className="staff-screen__col">
        <header className="staff-panel__header">
          <div className="staff-panel__shift">
            <Eyebrow>Ckyka Rewards</Eyebrow>
            <span className="staff-panel__who">{actor.username}</span>
          </div>
          <div className="staff-panel__pills">
            <StatusPill tone={actor.role === 'admin' ? 'terra' : 'forest'} dot>
              {actor.role === 'admin' ? 'Admin' : 'Staff'}
            </StatusPill>
          </div>
        </header>

        <Button variant="forest" size="lg" block onClick={onScan}>
          Scan
        </Button>

        <section aria-labelledby="staff-activity-title">
          <h2 id="staff-activity-title" className="staff-panel__section-title">
            Recent activity
          </h2>
          {!loaded ? (
            <p className="staff-panel__empty">Loading…</p>
          ) : items.length === 0 ? (
            <p className="staff-panel__empty">
              No activity yet. Scan a customer’s code to add their first coffee.
            </p>
          ) : (
            <div className="staff-panel__activity">
              {items.map((item) => (
                <ActivityRow
                  key={item.id}
                  actor={item.staffName}
                  action={item.action}
                  target={item.customerName}
                  time={relativeTime(item.timestamp)}
                />
              ))}
            </div>
          )}
        </section>

        <div className="staff-panel__footer">
          <Button variant="ghost" onClick={onSignOut}>
            Sign out / switch staff
          </Button>
        </div>
      </div>
    </div>
  );
}
