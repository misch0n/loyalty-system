/**
 * AdminHome — the admin area shell (UI-SPEC §4.10, §6).
 *
 * One screen at `/admin` with in-page tabbed sections (This week · Program ·
 * Staff · Activity · Alerts), laid out for a laptop and responsive down to a
 * phone. If the parent later registers `/admin/:section` (see `adminPath`), the
 * optional `:section` param deep-links a tab; absent, it defaults to "week".
 *
 * GUARD (top of the screen):
 *   - !ready                       → loading
 *   - status === 'locked'          → Navigate ROUTES.staffUnlock (PIN re-auth)
 *   - signed-in, role !== 'admin'  → "Admins only" notice
 *   - anonymous                    → Navigate ROUTES.login
 *
 * UI talks to services only; every admin mutation passes the authenticated
 * `actor` (enforced by the section components, which receive it as a prop).
 */

import { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { Eyebrow, StatusPill } from '../../kit';
import { useAuth } from '../../app/AuthContext';
import { ROUTES } from '../../app/routes';
import { ThisWeekSection } from './ThisWeekSection';
import { ProgramSection } from './ProgramSection';
import { StaffSection } from './StaffSection';
import { ActivityLogSection } from './ActivityLogSection';
import { AlertsSection } from './AlertsSection';
import './admin.css';

type SectionKey = 'week' | 'program' | 'staff' | 'activity' | 'alerts';

const TABS: { key: SectionKey; label: string }[] = [
  { key: 'week', label: 'This week' },
  { key: 'program', label: 'Program' },
  { key: 'staff', label: 'Staff' },
  { key: 'activity', label: 'Activity' },
  { key: 'alerts', label: 'Alerts' },
];

function isSection(value: string | undefined): value is SectionKey {
  return TABS.some((t) => t.key === value);
}

export function AdminHome() {
  const { actor, status, ready } = useAuth();
  const params = useParams<{ section?: string }>();
  const initial: SectionKey = isSection(params.section) ? params.section : 'week';
  const [active, setActive] = useState<SectionKey>(initial);

  // --- Guard ---------------------------------------------------------------
  if (!ready) {
    return (
      <main className="admin admin--center" aria-busy="true">
        <p className="admin-empty">Loading…</p>
      </main>
    );
  }
  if (status === 'locked') {
    return <Navigate to={ROUTES.staffUnlock} replace />;
  }
  if (!actor) {
    return <Navigate to={ROUTES.login} replace />;
  }
  if (actor.role !== 'admin') {
    return (
      <main className="admin admin--center">
        <div className="admin-notice">
          <Eyebrow tone="terra">Restricted</Eyebrow>
          <h1 className="admin-notice__title">Admins only</h1>
          <p className="admin-notice__body">
            You’re signed in as {actor.username}, but this area needs an admin account. Ask an admin
            to sign in here.
          </p>
        </div>
      </main>
    );
  }

  // --- Admin shell ---------------------------------------------------------
  return (
    <main className="admin">
      <header className="admin__header safe-top">
        <div className="admin__heading">
          <Eyebrow tone="sage">Ckyka Rewards</Eyebrow>
          <h1 className="admin__title">Admin</h1>
        </div>
        <StatusPill tone="terra" dot>
          {actor.username}
        </StatusPill>
      </header>

      <nav className="admin__tabs" aria-label="Admin sections">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`admin__tab ${active === tab.key ? 'admin__tab--active' : ''}`}
            aria-current={active === tab.key ? 'page' : undefined}
            onClick={() => setActive(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="admin__body">
        {active === 'week' && <ThisWeekSection />}
        {active === 'program' && <ProgramSection actor={actor} />}
        {active === 'staff' && <StaffSection actor={actor} />}
        {active === 'activity' && <ActivityLogSection />}
        {active === 'alerts' && <AlertsSection />}
      </div>
    </main>
  );
}
