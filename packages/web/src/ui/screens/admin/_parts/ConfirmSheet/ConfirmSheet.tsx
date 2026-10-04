/**
 * ConfirmSheet — "Are you sure?" for an admin action that cannot be taken back.
 *
 * It replaced the PIN step-up sheet (register A7, 2026-10-03). The PIN is gone
 * (S1), and the gate it stood for was never enforced by the server anyway: an
 * admin session can make these calls directly. What is worth keeping is the
 * pause before an irreversible tap, so this asks plainly and calls `onConfirm()`.
 * A failure inside `onConfirm` is the caller's to report.
 */
import { useEffect, useState } from 'react';
import { Button } from '../../../../components/Button/Button';
import { Sheet } from '../../../../components/Sheet/Sheet';
import './ConfirmSheet.css';

export interface ConfirmSheetProps {
  open: boolean;
  /** Close without confirming. */
  onClose: () => void;
  /** Called when the admin confirms. */
  onConfirm: () => void | Promise<void>;
  /** Sheet heading, e.g. "Sign out all devices?". */
  title: string;
  /** One-line explanation of what will happen. */
  message: string;
  /** The confirm button's label — name the action, e.g. "Sign out all". */
  confirmLabel: string;
}

export function ConfirmSheet({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
}: ConfirmSheetProps) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBusy(false);
  }, [open]);

  if (!open) return null;

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} label={title}>
      <h2 className="confirm-title">{title}</h2>
      <p className="confirm-msg">{message}</p>
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
