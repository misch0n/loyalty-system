/**
 * Staff/admin sign-in (Ckyka view 08). Reached by the logo long-press —
 * discovery obfuscation, not access control; the password is the control.
 *
 * This is the FIRST sign-in on a device: username + password. (A PIN is asked
 * for later, only on a *remembered* device that has gone idle — see Unlock.)
 * "Remember this device" makes it a trusted café terminal: subsequent visits
 * re-auth with the quick PIN instead of the full form. A non-remembered device
 * prefills the last username so a returning shift just re-enters their password.
 *
 * On success we route by role (admin → admin, staff → counter) and record
 * activity. UI → services only (via `useAuth`); never touches adapters.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GestureLogo } from '../../../app/LogoGestures';
import { LogoMark } from '../../../components/Logo/Logo';
import { Eyebrow, Title, Sub } from '../../../components/Heading/Heading';
import { Button } from '../../../components/Button/Button';
import { Field, Toggle } from '../../../components/Field/Field';
import { useAuth } from '../../../app/AuthContext';
import { ROUTES } from '../../../app/routes';
import './Login.css';

export function Login(): JSX.Element {
  const navigate = useNavigate();
  const { loginWithPassword, recordActivity, lastUsername } = useAuth();

  const [username, setUsername] = useState(lastUsername ?? '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    if (submitting) return;
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await loginWithPassword(username.trim(), password, remember);
      if (!result.ok || !result.actor) {
        setPassword('');
        setError(result.reason ?? "That didn't match. Try again.");
        return;
      }
      recordActivity();
      const home = result.actor.role === 'admin' ? ROUTES.admin : ROUTES.staff;
      navigate(home, { replace: true });
    } catch {
      setError('Could not sign in. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="screen bg-cream center staff-login">
      <div className="screen-pad center staff-login__pad">
        <GestureLogo className="staff-login__logo">
          <LogoMark size="sm" />
        </GestureLogo>

        <Eyebrow className="staff-login__eyebrow">Ckyka rewards</Eyebrow>
        <Title className="staff-login__title">Staff sign-in</Title>
        <Sub className="staff-login__sub">Sign in with your username and password.</Sub>

        <div className="staff-login__gap" aria-hidden="true" />

        <form
          className="staff-login__form"
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit();
          }}
        >
          <Field
            label="Username"
            type="text"
            autoComplete="username"
            placeholder="maria"
            value={username}
            onChange={(next) => {
              setError(null);
              setUsername(next);
            }}
            disabled={submitting}
          />
          <Field
            label="Password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(next) => {
              setError(null);
              setPassword(next);
            }}
            disabled={submitting}
          />

          <div className="staff-login__remember">
            <Toggle on={remember} onChange={setRemember} label="Remember this device" />
          </div>

          {error && (
            <p className="staff-login__error" role="alert">
              {error}
            </p>
          )}

          <Button variant="forest" type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        {remember && (
          <p className="staff-login__caution">Only on the café’s own device.</p>
        )}

        <div className="spacer" />
        <Sub className="staff-login__note">
          On a remembered device we’ll ask for your PIN after 5 minutes of inactivity.
        </Sub>
      </div>
    </div>
  );
}
