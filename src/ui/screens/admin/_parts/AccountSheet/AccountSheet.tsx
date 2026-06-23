/**
 * AccountSheet — the per-profile management popover (admin).
 *
 * Tapping a profile in the account list opens this shared `Sheet`. It shows the
 * profile (name · username · role), the actions an admin can take on it —
 * enable/disable, reset password, reset PIN, delete — and that profile's own
 * action history (the audit log filtered to this actor).
 *
 * Per the current product decision these actions are NOT step-up gated: a
 * signed-in admin on the device can perform them directly. Password/PIN entry
 * uses prompt() (the prototype's lightweight input, matching the rest of admin).
 */
import { useCallback, useEffect, useState } from 'react';
import { Sheet } from '../../../../components/Sheet/Sheet';
import { Toggle } from '../../../../components/Field/Field';
import { useServices } from '../../../../common/ServicesContext';
import { useToast } from '../../../../components/Toast/Toast';
import type { Actor } from '../../../../../services/types';
import type { AuditLogEntry, StaffAccount } from '../../../../../domain/models';
import { auditVerb, relativeTime } from '../../Admin/format';
import './AccountSheet.css';

export interface AccountSheetProps {
  /** The profile to manage, or null when the sheet is closed. */
  account: StaffAccount | null;
  actor: Actor;
  onClose: () => void;
  /** Called after any change so the parent can reload the list. */
  onChanged: () => void;
}

const HISTORY_LIMIT = 20;

export function AccountSheet({ account, actor, onClose, onChanged }: AccountSheetProps) {
  const services = useServices();
  const toast = useToast();
  const [history, setHistory] = useState<AuditLogEntry[] | null>(null);
  const [busy, setBusy] = useState(false);

  const accountId = account?.id;

  const loadHistory = useCallback(() => {
    if (!accountId) return;
    setHistory(null);
    void services.audit
      .list({ actorId: accountId, limit: HISTORY_LIMIT })
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [services, accountId]);

  useEffect(() => {
    if (accountId) loadHistory();
  }, [accountId, loadHistory]);

  if (!account) return null;

  const run = async (fn: () => Promise<void>, done: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      toast.show(done);
      onChanged();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Couldn’t make that change.');
    } finally {
      setBusy(false);
    }
  };

  const onToggleActive = () =>
    run(
      () => services.staff.setActive(actor, account.id, !account.active),
      account.active ? 'Profile disabled.' : 'Profile enabled.',
    );

  const onResetPassword = () => {
    const next = window.prompt(`New password for ${account.name ?? account.username}`);
    if (next == null || next === '') return;
    void run(() => services.staff.resetPassword(actor, account.id, next), 'Password reset.');
  };

  const onResetPin = () => {
    const next = window.prompt(`New sign-in PIN for ${account.name ?? account.username} (4–8 digits)`);
    const pin = (next ?? '').replace(/\D/g, '');
    if (pin.length < 4) {
      if (next != null) toast.show('A PIN needs 4–8 digits. No change made.');
      return;
    }
    void run(() => services.staff.setPin(actor, account.id, pin), 'PIN set.');
  };

  const onDelete = () => {
    const ok = window.confirm(
      `Delete ${account.name ?? account.username}? This removes the account permanently.`,
    );
    if (!ok) return;
    void run(async () => {
      await services.staff.remove(actor, account.id);
      onClose();
    }, 'Profile deleted.');
  };

  return (
    <Sheet open onClose={onClose} label={`Manage ${account.name ?? account.username}`}>
      <div className="acct">
        <div className="acct-head">
          <div>
            <div className="acct-name">{account.name ?? account.username}</div>
            <div className="acct-meta">
              {account.username} · <span className="acct-role">{account.role}</span>
              {!account.active && <span className="acct-disabled"> · disabled</span>}
            </div>
          </div>
        </div>

        <div className="acct-actions">
          <div className="acct-row">
            <span>Active</span>
            <Toggle on={account.active} onChange={onToggleActive} label="Active" />
          </div>
          <button type="button" className="acct-btn" onClick={onResetPassword} disabled={busy}>
            Reset password
          </button>
          <button type="button" className="acct-btn" onClick={onResetPin} disabled={busy}>
            Reset PIN
          </button>
          <button
            type="button"
            className="acct-btn danger"
            onClick={onDelete}
            disabled={busy}
          >
            Delete profile
          </button>
        </div>

        <div className="acct-h">Activity</div>
        {history == null ? (
          <p className="acct-empty">Loading…</p>
        ) : history.length === 0 ? (
          <p className="acct-empty">No recorded actions for this profile yet.</p>
        ) : (
          <ul className="acct-feed">
            {history.map((entry) => (
              <li key={entry.id}>
                <span className="acct-verb">{auditVerb(entry.action)}</span>
                <span className="acct-time">{relativeTime(entry.timestamp)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
