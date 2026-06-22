/**
 * App shell: header with a quick-navigation switcher, and the routed content
 * area. The switcher is a prototype affordance for jumping between the staff
 * areas and the customer view during a demo; real devices use one area each.
 */

import { NavLink, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSession } from './SessionContext';

function NavTab({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink to={to} className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
      {children}
    </NavLink>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { actor, logout } = useSession();
  const location = useLocation();
  const inStaffArea = location.pathname.startsWith('/staff') || location.pathname.startsWith('/admin');

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ☕
          </span>
          <span>Café Loyalty</span>
          <span className="proto-tag" title="Prototype — demo data only">
            prototype
          </span>
        </div>

        <nav className="device-switcher" aria-label="Demo device">
          <NavTab to="/staff">Staff</NavTab>
          <NavTab to="/admin/stats">Admin</NavTab>
          <NavTab to="/">Customer</NavTab>
        </nav>

        <div className="session-box">
          {actor ? (
            <>
              <span className="who">
                {actor.username} · {actor.role}
              </span>
              <button type="button" className="link" onClick={logout}>
                Log out
              </button>
            </>
          ) : (
            inStaffArea && <span className="who muted">Not signed in</span>
          )}
        </div>
      </header>

      {(location.pathname.startsWith('/staff') || location.pathname.startsWith('/admin')) &&
        actor && (
          <nav className="subnav" aria-label="Sections">
            <NavTab to="/staff">Scan</NavTab>
            <NavTab to="/staff/issue">Issue card</NavTab>
            <NavTab to="/staff/find">Find customer</NavTab>
            {actor.role === 'admin' && (
              <>
                <span className="subnav-divider" aria-hidden="true">
                  ·
                </span>
                <NavTab to="/admin/staff">Staff</NavTab>
                <NavTab to="/admin/program">Program</NavTab>
                <NavTab to="/admin/stats">Stats</NavTab>
                <NavTab to="/admin/audit">Audit log</NavTab>
              </>
            )}
          </nav>
        )}

      <main className="app-main">{children}</main>

      <footer className="app-footer">
        Demo only — browser storage, no real customer data. The system never
        handles money.
      </footer>
    </div>
  );
}
