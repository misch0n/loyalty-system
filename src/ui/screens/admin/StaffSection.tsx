/**
 * Staff management (UI-SPEC §4.10, UX-SPEC §6, §8).
 *
 * Lists named staff accounts and supports: create (username + role + initial
 * credential), enable/disable (setActive), and reset the credential
 * (resetPassword), and set/replace the sign-in PIN (setPin). The create form
 * takes an optional initial PIN. "Sign out all devices" revokes every trusted
 * session via `staff.revokeAllSessions(actor)` behind STEP-UP re-auth, then
 * toasts the count.
 *
 * Sign-in is by PIN, so "Set PIN" is the credential a staffer types to sign in;
 * "Reset password" manages the secondary username/password credential.
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
  const [newPin, setNewPin] = useState('');
  const [newRole, setNewRole] = useState<StaffRole>('staff');
  const [createError, setCreateError] = useState<string | null>(null);

  // Per-account password reset.
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetValue, setResetValue] = useState('');

  // Per-account PIN set/replace.
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [pinValue, setPinValue] = useState('');

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
      await services.staff.create(actor, newUsername, newPassword, newRole, newPin || undefined);
      setNewUsername('');
      setNewPassword('');
      setNewPin('');
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

  const submitPin = async (id: string) => {
    try {
      await services.staff.setPin(actor, id, pinValue);
      setPinFor(null);
      setPinValue('');
      toast.show('PIN set.', { tone: 'success' });
    } catch (err) {
      toast.show(
        err instanceof Error ? err.message : 'Couldn’t set that PIN.',
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
        Sign-in uses a PIN. Use “Set PIN” to give a staffer their sign-in code (4–8 digits).
        The password is a secondary account credential.
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
                  setPinFor(pinFor === account.id ? null : account.id);
                  setPinValue('');
                }}
              >
                Set PIN
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
            {pinFor === account.id && (
              <div className="admin-staff-row__reset">
                <Field
                  label="Sign-in PIN"
                  hint="4–8 digits. This is the code the staffer types to sign in."
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={pinValue}
                  onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ''))}
                />
                <Button
                  variant="forest"
                  disabled={pinValue.length < 4}
                  onClick={() => submitPin(account.id)}
                >
                  Save PIN
                </Button>
              </div>
            )}
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
          hint="Secondary account credential (the sign-in code is the PIN below)."
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <Field
          label="Sign-in PIN (optional)"
          hint="4–8 digits the staffer types to sign in. You can also set it later."
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={newPin}
          onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
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
