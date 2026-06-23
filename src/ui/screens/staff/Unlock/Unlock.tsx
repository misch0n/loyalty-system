/**
 * Staff unlock — quick PIN re-auth for a locked trusted device (Ckyka view 08
 * styling, "re-auth" state). Same screen as sign-in but the device stays
 * trusted: this is an unlock, not a full re-enrol.
 *
 * Only reachable while the session is `locked`; any other status redirects
 * (active → panel, anon → sign-in). The PIN auto-submits at full length via
 * `useAuth().unlock`; on success we record activity and resume the staff panel.
 * Reuses the FIXED old StaffUnlock behaviour, restyled to the reference markup.
 */
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { GestureLogo } from '../../../app/LogoGestures';
import { LogoMark } from '../../../components/Logo/Logo';
import { Eyebrow, Title, Sub } from '../../../components/Heading/Heading';
import { PinPad } from '../../../components/PinPad/PinPad';
import { useAuth } from '../../../app/AuthContext';
import { ROUTES } from '../../../app/routes';
import './Unlock.css';

const PIN_LENGTH = 4;

export function Unlock(): JSX.Element {
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
      <div className="screen bg-cream center staff-login" role="status" aria-live="polite">
        <div className="screen-pad center staff-login__pad">
          <Sub>Loading…</Sub>
        </div>
      </div>
    );
  }

  // Only a locked device unlocks here; everything else routes to its home.
  if (status === 'active') return <Navigate to={ROUTES.staff} replace />;
  if (status !== 'locked') return <Navigate to={ROUTES.login} replace />;

  return (
    <div className="screen bg-cream center staff-login">
      <div className="screen-pad center staff-login__pad">
        <GestureLogo className="staff-login__logo">
          <LogoMark size="sm" />
        </GestureLogo>

        <Eyebrow className="staff-login__eyebrow">Ckyka rewards</Eyebrow>
        <Title className="staff-login__title">Enter your PIN to continue</Title>
        <Sub className="staff-login__sub">This device stays signed in — just confirm it’s you.</Sub>

        <div className="staff-login__gap" aria-hidden="true" />

        <PinPad
          value={pin}
          onChange={(next) => {
            setError(null);
            setPin(next);
          }}
          length={PIN_LENGTH}
          disabled={verifying}
        />

        {error && (
          <p className="staff-login__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
