/**
 * Staff management (UI-SPEC §4.10, UX-SPEC §6, §8).
 *
 * Lists named staff accounts and supports: create (username + role + initial
 * credential), enable/disable (setActive), and reset the credential
 * (resetPassword). "Sign out all devices" revokes every trusted session via
 * `staff.revokeAllSessions(actor)` behind STEP-UP re-auth, then toasts the count.
 *
 * BACKEND GAP (flagged): there is no PIN-reset service method, and `create`
 * takes a PASSWORD, not a PIN. The staff sign-in screen uses PINs, so the
 * credential managed here is the password — NOT the PIN a staffer types to sign
 * in. The field is labelled honestly ("Password") and a notice spells this out.
 * Resolving it means adding e.g. `staff.setPin(actor, id, pin)` +
 * `create(..., pin)` to StaffService.
 */

import { useCallback, useEffect, useState } from 'react';
import { Banner, Button, Eyebrow, Field, StatusPill, useToast } from '../../kit';
import { useServices } from '../../common/ServicesContext';
import type { Actor } from '../../../services/types';
import type { StaffAccount, StaffRole } from '../../../domain/models';
import { StepUpSheet } from './StepUpSheet';

export function StaffSection({ actor }: { actor: Actor }) {
  const services = useServices();
  const toast = useToast();
  const [staff, setStaff] = useState<StaffAccount[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Create form.
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<StaffRole>('staff');
  const [createError, setCreateError] = useState<string | null>(null);

  // Per-account password reset.
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetValue, setResetValue] = useState('');

  // Revoke-all step-up.
  const [revokeOpen, setRevokeOpen] = useState(false);

  const refresh = useCallback(() => {
    let cancelled = false;
    services.staff
      .list()
      .then((list) => {
        if (!cancelled) {
          setStaff(list);
          setLoadError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [services]);

  useEffect(() => refresh(), [refresh]);

  const createAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    try {
      await services.staff.create(actor, newUsername, newPassword, newRole);
      setNewUsername('');
      setNewPassword('');
      setNewRole('staff');
      toast.show('Staff account added.', { tone: 'success' });
      refresh();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Couldn’t add that account.');
    }
  };

  const toggleActive = async (account: StaffAccount) => {
    try {
      await services.staff.setActive(actor, account.id, !account.active);
      toast.show(account.active ? 'Account disabled.' : 'Account enabled.', { tone: 'success' });
      refresh();
    } catch {
      toast.show('Couldn’t change that account. Try again.', { tone: 'warning' });
    }
  };

  const submitReset = async (id: string) => {
    try {
      await services.staff.resetPassword(actor, id, resetValue);
      setResetFor(null);
      setResetValue('');
      toast.show('Password reset.', { tone: 'success' });
    } catch (err) {
      toast.show(
        err instanceof Error ? err.message : 'Couldn’t reset that password.',
        { tone: 'warning' },
      );
    }
  };

  const revokeAll = async () => {
    try {
      const count = await services.staff.revokeAllSessions(actor);
      setRevokeOpen(false);
      toast.show(`Signed out all devices (epoch ${count}).`, { tone: 'success' });
    } catch {
      setRevokeOpen(false);
      toast.show('Couldn’t sign out devices. Try again.', { tone: 'warning' });
    }
  };

  return (
    <section className="admin-section" aria-labelledby="admin-staff-h">
      <Eyebrow>People</Eyebrow>
      <h2 id="admin-staff-h" className="admin-section__title">
        Staff management
      </h2>

      <Banner tone="info">
        Sign-in uses a PIN, but accounts are managed by password here — there’s no PIN reset yet.
        The password below is the account credential, not the sign-in PIN.
      </Banner>

      {loadError && <Banner tone="warning">Couldn’t load staff. Refresh to try again.</Banner>}

      <ul className="admin-staff-list">
        {staff?.map((account) => (
          <li key={account.id} className="admin-staff-row">
            <div className="admin-staff-row__main">
              <span className="admin-staff-row__name">{account.username}</span>
              <StatusPill tone={account.role === 'admin' ? 'terra' : 'sage'}>
                {account.role}
              </StatusPill>
              <StatusPill tone={account.active ? 'forest' : 'neutral'} dot>
                {account.active ? 'Active' : 'Disabled'}
              </StatusPill>
            </div>
            <div className="admin-staff-row__actions">
              <Button variant="line" onClick={() => toggleActive(account)}>
                {account.active ? 'Disable' : 'Enable'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setResetFor(resetFor === account.id ? null : account.id);
                  setResetValue('');
                }}
              >
                Reset password
              </Button>
            </div>
            {resetFor === account.id && (
              <div className="admin-staff-row__reset">
                <Field
                  label="New password"
                  type="password"
                  autoComplete="new-password"
                  value={resetValue}
                  onChange={(e) => setResetValue(e.target.value)}
                />
                <Button
                  variant="forest"
                  disabled={!resetValue}
                  onClick={() => submitReset(account.id)}
                >
                  Save password
                </Button>
              </div>
            )}
          </li>
        ))}
        {staff && staff.length === 0 && (
          <li className="admin-empty">No staff accounts yet — add the first one below.</li>
        )}
      </ul>

      <form className="admin-form admin-staff-create" onSubmit={createAccount}>
        <h3 className="admin-subhead">Add a staff account</h3>
        <Field
          label="Username"
          type="text"
          autoComplete="off"
          value={newUsername}
          onChange={(e) => setNewUsername(e.target.value)}
        />
        <Field
          label="Password"
          hint="Initial account credential (not the sign-in PIN — see the note above)."
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <label className="admin-field">
          <span className="admin-field__label">Role</span>
          <select
            className="admin-select"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as StaffRole)}
          >
            <option value="staff">Staff</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        {createError && <p className="admin-error" role="alert">{createError}</p>}
        <div className="admin-form__actions">
          <Button variant="forest" type="submit" disabled={!newUsername || !newPassword}>
            Add account
          </Button>
        </div>
      </form>

      <div className="admin-section__danger">
        <h3 className="admin-subhead">Devices</h3>
        <p className="admin-section__note">
          Sign out every trusted terminal — for a lost tablet or a staff departure. Each device
          falls back to a fresh sign-in.
        </p>
        <Button variant="line" onClick={() => setRevokeOpen(true)}>
          Sign out all devices
        </Button>
      </div>

      <StepUpSheet
        open={revokeOpen}
        onClose={() => setRevokeOpen(false)}
        onConfirm={revokeAll}
        title="Sign out all devices"
        message="Re-enter your PIN to revoke every trusted session."
      />
    </section>
  );
}
