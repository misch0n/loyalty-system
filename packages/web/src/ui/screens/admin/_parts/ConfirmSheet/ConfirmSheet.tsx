/**
 * ConfirmSheet — "Are you sure?" for an admin action that cannot be taken back.
 *
 * It replaced the PIN step-up sheet (register A7, 2026-10-03). The PIN is gone
 * (S1), and the gate it stood for was never enforced by the server anyway: an
 * admin session can make these calls directly. What is worth keeping is the
 * pause before an irreversible tap, so this asks plainly and calls `onConfirm()`.
 *
 * **A failure stays in the sheet (UI-4, X2).** If `onConfirm` rejects, the sheet
 * stays open and says what went wrong under the message (`role="alert"`), so
 * the admin can try again or cancel — never a toast. `describeError` words it;
 * the default is the admin wording with a generic fallback. On success the
 * caller closes the sheet (or navigates away).
 */
import { useEffect, useState } from 'react';
import { Button } from '../../../../components/Button/Button';
import { Sheet } from '../../../../components/Sheet/Sheet';
import { adminFailureMessage } from '../adminFailure';
import './ConfirmSheet.css';

export interface ConfirmSheetProps {
  open: boolean;
  /** Close without confirming. */
  onClose: () => void;
  /** Called when the admin confirms. Reject to keep the sheet open with the failure. */
  onConfirm: () => void | Promise<void>;
  /** Sheet heading, e.g. "Sign out all devices?". */
  title: string;
  /** One-line explanation of what will happen. */
  message: string;
  /** The confirm button's label — name the action, e.g. "Sign out all". */
  confirmLabel: string;
  /** Turns a rejected `onConfirm` into the sentence shown in the sheet (`null`: show nothing). */
  describeError?: (err: unknown) => string | null;
}

const describeDefault = (err: unknown) =>
  adminFailureMessage(err, 'Couldn’t make that change. Try again.');

export function ConfirmSheet({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  describeError = describeDefault,
}: ConfirmSheetProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBusy(false);
    setError(null);
  }, [open]);

  if (!open) return null;

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} label={title}>
      <h2 className="confirm-title">{title}</h2>
      <p className="confirm-msg">{message}</p>
      {error && (
        <p className="confirm-error" role="alert">
          {error}
        </p>
      )}
      <div className="confirm-actions">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="forest" onClick={() => void confirm()} disabled={busy}>
          {confirmLabel}
        </Button>
      </div>
    </Sheet>
  );
}
