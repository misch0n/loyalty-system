/**
 * StaffUnlock — quick PIN re-auth for a locked trusted device (UI-SPEC §4.7
 * "session-expired re-auth", UX-SPEC §6).
 *
 * Same PIN screen as sign-in, but the device stays trusted: this is an unlock,
 * not a full re-enrol. Only reachable while the session is `locked`; any other
 * status redirects (active → panel, anon → sign-in). On a correct PIN we resume
 * the staff panel.
 */

import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { PinPad } from '../../kit';
import { useAuth } from '../../app/AuthContext';
import { ROUTES } from '../../app/routes';
import './staff.css';

const PIN_LENGTH = 4;

export function StaffUnlock(): JSX.Element {
  const navigate = useNavigate();
  const { status, ready, unlock, recordActivity } = useAuth();

  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (status !== 'locked' || pin.length !== PIN_LENGTH || verifying) return;
    let cancelled = false;
    setVerifying(true);
    setError(null);
    void unlock(pin)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          recordActivity();
          navigate(ROUTES.staff, { replace: true });
          return;
        }
        setPin('');
        setError(result.reason ?? "That PIN didn't match. Try again.");
      })
      .finally(() => {
        if (!cancelled) setVerifying(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pin, status, verifying, unlock, navigate, recordActivity]);

  if (!ready) {
    return (
      <div className="staff-screen" role="status" aria-live="polite">
        <div className="staff-screen__col staff-auth">
          <p className="staff-auth__sub">Loading…</p>
        </div>
      </div>
    );
  }

  // Only a locked device unlocks here; everything else routes to its home.
  if (status === 'active') return <Navigate to={ROUTES.staff} replace />;
  if (status !== 'locked') return <Navigate to={ROUTES.login} replace />;

  return (
    <div className="staff-screen">
      <div className="staff-screen__col staff-auth">
        <p className="staff-auth__brand">Ckyka Rewards</p>
        <h1 className="staff-auth__title">Enter your PIN to continue</h1>
        <p className="staff-auth__sub">This device stays signed in — just confirm it’s you.</p>

        <div className="staff-auth__pad">
          <PinPad
            value={pin}
            onChange={(next) => {
              setError(null);
              setPin(next);
            }}
            length={PIN_LENGTH}
            disabled={verifying}
            error={error}
          />
        </div>
      </div>
    </div>
  );
}
