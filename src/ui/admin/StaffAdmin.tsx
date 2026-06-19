/**
 * StaffAdmin — admin manages staff accounts. Disabling a departed employee is
 * the critical control: they immediately lose the ability to issue/redeem.
 */

import { useCallback, useEffect, useState } from 'react';
import { useServices } from '../common/ServicesContext';
import { useSession } from '../common/SessionContext';
import type { StaffAccount, StaffRole } from '../../domain/models';

export function StaffAdmin() {
  const { staff } = useServices();
  const { actor } = useSession();
  const [list, setList] = useState<StaffAccount[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<StaffRole>('staff');
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setList(await staff.list());
  }, [staff]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!actor) return;
    setError(null);
    setFlash(null);
    try {
      await staff.create(actor, username, password, role);
      setUsername('');
      setPassword('');
      setRole('staff');
      setFlash('Account created.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account.');
    }
  }

  async function toggleActive(account: StaffAccount) {
    if (!actor) return;
    await staff.setActive(actor, account.id, !account.active);
    setFlash(account.active ? 'Account disabled.' : 'Account enabled.');
    await refresh();
  }

  async function resetPassword(account: StaffAccount) {
    if (!actor) return;
    const next = prompt(`New password for ${account.username}:`);
    if (!next) return;
    await staff.resetPassword(actor, account.id, next);
    setFlash('Password reset.');
  }

  return (
    <div className="screen">
      <h1>Staff accounts</h1>
      {flash && <p className="flash">{flash}</p>}

      <div className="card">
        <h2>Add an account</h2>
        <form onSubmit={create} className="inline-form">
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label>
            Password
            <input value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button type="submit" disabled={!username || !password}>
            Create account
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="card">
        <h2>Accounts</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((account) => (
              <tr key={account.id} className={account.active ? '' : 'disabled-row'}>
                <td>{account.username}</td>
                <td>{account.role}</td>
                <td>{account.active ? 'Active' : 'Disabled'}</td>
                <td className="row-actions">
                  <button
                    type="button"
                    className="link"
                    disabled={account.id === actor?.id}
                    onClick={() => toggleActive(account)}
                  >
                    {account.active ? 'Disable' : 'Enable'}
                  </button>
                  <button type="button" className="link" onClick={() => resetPassword(account)}>
                    Reset password
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
