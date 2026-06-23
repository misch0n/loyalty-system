/**
 * This week — admin stat cards (UI-SPEC §4.10).
 *
 * Derives figures from `loyalty.getStats()` (active members, points issued,
 * rewards redeemed). "Coffees today" is derived by filtering the audit trail
 * for today's `loyalty.accrue` entries — the only same-day signal available
 * without changing the ledger schema; see the BACKEND GAP note below.
 */

import { useEffect, useState } from 'react';
import { Banner, Eyebrow, StatCard } from '../../kit';
import { useServices } from '../../common/ServicesContext';
import { isSameDay } from './adminFormat';

interface Stats {
  activeCustomers: number;
  pointsIssued: number;
  rewardsRedeemed: number;
}

export function ThisWeekSection() {
  const services = useServices();
  const [stats, setStats] = useState<Stats | null>(null);
  const [coffeesToday, setCoffeesToday] = useState<number | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    Promise.all([
      services.loyalty.getStats(),
      // BACKEND GAP: there is no "coffees today" service read. We approximate it
      // by counting today's `loyalty.accrue` audit rows. This counts accrual
      // EVENTS, not points added (a multi-add of 2 counts once). Honest label
      // below. A dedicated windowed stat would belong in LoyaltyService.
      services.audit.list({ action: 'loyalty.accrue', limit: 500 }),
    ])
      .then(([s, accruals]) => {
        if (cancelled) return;
        setStats(s);
        setCoffeesToday(accruals.filter((a) => isSameDay(a.timestamp)).length);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [services]);

  return (
    <section className="admin-section" aria-labelledby="admin-thisweek-h">
      <Eyebrow>Overview</Eyebrow>
      <h2 id="admin-thisweek-h" className="admin-section__title">
        This week
      </h2>
      {error && (
        <Banner tone="warning">Couldn’t load the latest figures. Refresh to try again.</Banner>
      )}
      <div className="admin-stats-grid">
        <StatCard
          tone="sage"
          value={stats ? stats.activeCustomers : '—'}
          label="Active members"
        />
        <StatCard
          tone="blush"
          value={coffeesToday ?? '—'}
          label="Coffees today"
          note="credits logged today"
        />
        <StatCard
          tone="cream"
          value={stats ? stats.rewardsRedeemed : '—'}
          label="Rewards redeemed"
          note="all time"
        />
      </div>
      <p className="admin-section__note">
        Active members and rewards redeemed are all-time totals from the ledger. Coffees today
        counts credits logged since midnight.
      </p>
    </section>
  );
}
