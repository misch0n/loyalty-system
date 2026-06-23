/**
 * Staff sign-in (Ckyka view 08). Reached by the logo long-press — discovery
 * obfuscation, not access control; the PIN is the control. A named staff PIN
 * attaches that identity to every ledger entry this session.
 *
 * Layout: a centred cream screen with the gesture-bearing logo mark, the brand
 * eyebrow, title + sub, the kit PinPad, a "Remember this device" toggle (trusted
 * terminal → boots to the panel, re-auth after 5 min idle), and the idle note.
 *
 * Behaviour mirrors the FIXED old StaffLogin: the PIN auto-submits at full
 * length via `useAuth().loginWithPin`. A ref guard (NOT `verifying` in the
 * effect deps) keys the trigger to the PIN reaching length and prevents the pad
 * ever freezing — `verifying` is reset in `finally`. Wrong PIN clears the entry,
 * shows an instructive line, and a sane attempt limit applies. On success we
 * record activity and navigate to the staff panel. UI → services only (auth
 * seam); never touches adapters.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GestureLogo } from '../../../app/LogoGestures';
import { LogoMark } from '../../../components/Logo/Logo';
import { Eyebrow, Title, Sub } from '../../../components/Heading/Heading';
import { Button } from '../../../components/Button/Button';
import { PinPad } from '../../../components/PinPad/PinPad';
import { Toggle } from '../../../components/Field/Field';
import { useAuth } from '../../../app/AuthContext';
import { ROUTES } from '../../../app/routes';
import './Login.css';

const PIN_LENGTH = 4;
const MAX_ATTEMPTS = 5;

export function Login(): JSX.Element {
  const navigate = useNavigate();
  const { loginWithPin, recordActivity } = useAuth();

  const [pin, setPin] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [attempts, setAttempts] = useState(0);

  const lockedOut = attempts >= MAX_ATTEMPTS;

  // Re-entrancy guard WITHOUT `verifying` in the effect deps: putting it there
  // would re-run the effect the instant we set it, and the prior run's cleanup
  // would cancel the in-flight verify — leaving the pad frozen. The ref keys the
  // trigger only to the PIN reaching full length; `verifying` resets in finally.
  const verifyingRef = useRef(false);

  useEffect(() => {
    if (pin.length !== PIN_LENGTH || verifyingRef.current || lockedOut) return;
    let cancelled = false;
    verifyingRef.current = true;
    setVerifying(true);
    setError(null);
    void loginWithPin(pin, remember)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          recordActivity();
          navigate(ROUTES.staff, { replace: true });
          return;
        }
        setPin('');
        setAttempts((n) => n + 1);
        setError("That PIN didn't match. Try again.");
      })
      .finally(() => {
        verifyingRef.current = false;
        if (!cancelled) setVerifying(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pin, remember, lockedOut, loginWithPin, navigate, recordActivity]);

  return (
    <div className="screen bg-cream center staff-login">
      <div className="screen-pad center staff-login__pad">
        <GestureLogo className="staff-login__logo">
          <LogoMark size="sm" />
        </GestureLogo>

        <Eyebrow className="staff-login__eyebrow">Ckyka rewards</Eyebrow>
        <Title className="staff-login__title">Staff sign-in</Title>
        <Sub className="staff-login__sub">Enter your PIN to start your shift.</Sub>

        <div className="staff-login__gap" aria-hidden="true" />

        <PinPad
          value={pin}
          onChange={(next) => {
            setError(null);
            setPin(next);
          }}
          length={PIN_LENGTH}
          disabled={verifying || lockedOut}
          rememberSlot={
            <Toggle
              on={remember}
              onChange={setRemember}
              label="Remember this device"
            />
          }
        />

        {error && !lockedOut && (
          <p className="staff-login__error" role="alert">
            {error}
          </p>
        )}

        {lockedOut && (
          <>
            <p className="staff-login__error" role="alert">
              Too many tries. Ask a manager, then try again in a moment.
            </p>
            <div className="staff-login__retry">
              <Button
                variant="line"
                onClick={() => {
                  setAttempts(0);
                  setError(null);
                  setPin('');
                }}
              >
                Try again
              </Button>
            </div>
          </>
        )}

        {remember && !lockedOut && (
          <p className="staff-login__caution">Only on the café’s own device.</p>
        )}

        <div className="spacer" />
        <Sub className="staff-login__note">
          We’ll ask for your PIN again after 5 minutes of inactivity.
        </Sub>
      </div>
    </div>
  );
}
