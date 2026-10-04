/**
 * AccountSheet — the per-profile management popover (admin).
 *
 * Tapping a profile in the account list opens this shared `Sheet`. It shows the
 * profile (name · username · role), the actions an admin can take on it —
 * enable/disable, reset password, delete. (There is no PIN to reset — S1.)
 *
 * **Your own account (register A6).** The server refuses both disabling
 * (`cannot_disable_self`) and deleting (`cannot_delete_self`) the account the
 * request is signed in with — it is the one guard that keeps an admin from
 * locking the shop out of its own panel. So on the signed-in account's own
 * sheet neither control is offered: the toggle and the delete button are shown
 * disabled, with one line saying why, rather than inviting a tap the server
 * will refuse.
 *
 * **Failures stay in the sheet.** A refusal — from `StaffService`, which turns
 * the server's codes into sentences, or a connectivity failure — is shown inside
 * the sheet, beside the controls, and never as a toast (X2: an action failure
 * belongs on the control that caused it). Success still confirms with a toast.
 * The wording is the admin-wide one (`adminFailure.ts`, on `failureMessage`),
 * so offline, server, out-of-date-page and signed-out read the same as on every
 * other admin sheet.
 *
 * Appendix E: the profile's action-history list was REMOVED. Reading one
 * person's activity is an investigation, not a casual glance.
 *
 * Per the current product decision these actions are NOT step-up gated: a
 * signed-in admin on the device can perform them directly. Password entry uses
 * prompt() (the prototype's lightweight input, matching the rest of admin).
 */
import { useEffect, useState } from 'react';
import { Sheet } from '../../../../components/Sheet/Sheet';
import { Toggle } from '../../../../components/Field/Field';
import { useServices } from '../../../../common/ServicesContext';
import { useToast } from '../../../../components/Toast/Toast';
import type { FailureOverrides } from '../../../../common/failure';
import { adminActionMessage } from '../adminFailure';
import type { Actor } from '../../../../../services/types';
import type { StaffAccount } from '@cafe/shared/domain/models';
import './AccountSheet.css';

export interface AccountSheetProps {
  /** The profile to manage, or null when the sheet is closed. */
  account: StaffAccount | null;
  actor: Actor;
  onClose: () => void;
  /** Called after any change so the parent can reload the list. */
  onChanged: () => void;
}

/** The note on the signed-in account's own sheet. */
export const SELF_NOTE = 'You can’t disable or delete the account you’re signed in with.';

/** What went wrong, as a sentence the admin can act on (`null`: signed out — said globally). */
function describeFailure(err: unknown, overrides: FailureOverrides = {}): string | null {
  return adminActionMessage(err, 'Couldn’t make that change. Try again.', {
    not_found: 'That account no longer exists.',
    ...overrides,
  });
}

/** A password the server's length rule refused (`invalid_request`). */
const PASSWORD_REJECTED = 'That password wasn’t accepted. Use at least 8 characters.';

export function AccountSheet({ account, actor, onClose, onChanged }: AccountSheetProps) {
  const services = useServices();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A different profile (or a closed sheet) starts with a clean slate.
  const accountId = account?.id ?? null;
  useEffect(() => setError(null), [accountId]);

  if (!account) return null;

  const isSelf = account.id === actor.id;

  const run = async (fn: () => Promise<void>, done: string, overrides?: FailureOverrides) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast.show(done);
      onChanged();
    } catch (err) {
      setError(describeFailure(err, overrides));
    } finally {
      setBusy(false);
    }
  };

  const onToggleActive = () => {
    if (isSelf) return;
    void run(
      () => services.staff.setActive(account.id, !account.active),
      account.active ? 'Profile disabled.' : 'Profile enabled.',
    );
  };

  const onResetPassword = () => {
    const next = window.prompt(`New password for ${account.name ?? account.username}`);
    if (next == null || next === '') return;
    void run(() => services.staff.resetPassword(account.id, next), 'Password reset.', {
      rejected: PASSWORD_REJECTED,
    });
  };

  const onDelete = () => {
    if (isSelf) return;
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
              {isSelf && <span className="acct-self"> · you</span>}
            </div>
          </div>
        </div>

        <div className="acct-actions">
          <div className="acct-row">
            <span>Active</span>
            <Toggle
              on={account.active}
              onChange={onToggleActive}
              label="Active"
              disabled={busy || isSelf}
            />
          </div>
          <button type="button" className="acct-btn" onClick={onResetPassword} disabled={busy}>
            Reset password
          </button>
          <button
            type="button"
            className="acct-btn danger"
            onClick={onDelete}
            disabled={busy || isSelf}
          >
            Delete profile
          </button>
          {isSelf && <p className="acct-note">{SELF_NOTE}</p>}
          {error && (
            <p className="acct-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </Sheet>
  );
}
