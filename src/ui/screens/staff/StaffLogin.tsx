/**
 * StaffLogin — PIN sign-in reached via the logo long-press (UI-SPEC §4.7,
 * UX-SPEC §6).
 *
 * Brand-quiet screen with the kit PinPad. The long-press is discovery
 * obfuscation; the PIN is the access control. A "remember this device" toggle
 * makes the device a trusted café terminal (warned: café-owned devices only).
 * On a complete, correct PIN we navigate to the staff panel; a wrong PIN shows
 * an instructive line and clears the entry, with a sensible attempt limit (no
 * lockout drama).
 *
 * UI → services only: this screen calls `useAuth().loginWithPin`, which is the
 * session seam over `services.staff.loginWithPin`. It never touches adapters.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PinPad, Button } from '../../kit';
import { useAuth } from '../../app/AuthContext';
import { ROUTES } from '../../app/routes';
import './staff.css';

const PIN_LENGTH = 4;
const MAX_ATTEMPTS = 5;

export function StaffLogin(): JSX.Element {
  const navigate = useNavigate();
  const { loginWithPin, recordActivity } = useAuth();

  const [pin, setPin] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [attempts, setAttempts] = useState(0);

  const lockedOut = attempts >= MAX_ATTEMPTS;

  // Guards against re-entrancy WITHOUT putting `verifying` in the effect deps:
  // doing so would re-run the effect the moment we set it, and the cleanup of
  // the prior run would cancel the in-flight verify — leaving `verifying` stuck
  // true (a frozen, permanently-disabled pad). The ref keeps the trigger keyed
  // only to the PIN reaching full length.
  const verifyingRef = useRef(false);

  // Auto-submit once the PIN reaches its expected length.
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
    <div className="staff-screen">
      <div className="staff-screen__col staff-auth">
        <p className="staff-auth__brand">Ckyka Rewards</p>
        <h1 className="staff-auth__title">Staff sign-in</h1>
        <p className="staff-auth__sub">Enter your PIN to start your shift.</p>

        <div className="staff-auth__pad">
          <PinPad
            value={pin}
            onChange={(next) => {
              setError(null);
              setPin(next);
            }}
            length={PIN_LENGTH}
            disabled={verifying || lockedOut}
            error={
              lockedOut
                ? 'Too many tries. Ask a manager, then try again in a moment.'
                : error
            }
            rememberSlot={
              <label className="staff-auth__remember">
                <input
                  type="checkbox"
                  checked={remember}
                  disabled={verifying || lockedOut}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Remember this device
              </label>
            }
          />
        </div>

        {remember && (
          <p className="staff-auth__caution">Only on the café’s own device.</p>
        )}

        <p className="staff-auth__note">
          We’ll ask for your PIN again after 5 minutes of inactivity.
        </p>

        {lockedOut && (
          <div className="staff-auth__actions">
            <Button
              variant="line"
              block
              onClick={() => {
                setAttempts(0);
                setError(null);
                setPin('');
              }}
            >
              Try again
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
