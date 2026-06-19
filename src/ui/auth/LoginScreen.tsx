/** Staff/Admin login (mock auth in the prototype). */

import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useServices } from '../common/ServicesContext';
import { useSession } from '../common/SessionContext';

export function LoginScreen() {
  const { staff } = useServices();
  const { setActor } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/staff';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await staff.login(username, password);
      if (!result.ok || !result.actor) {
        setError(result.reason ?? 'Could not sign in.');
        return;
      }
      setActor(result.actor);
      navigate(from, { replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card auth-card">
      <h1>Staff sign in</h1>
      <form onSubmit={onSubmit}>
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy || !username || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="hint">
        Demo accounts: <code>admin / admin</code> or <code>staff / staff</code>.
      </p>
    </div>
  );
}
