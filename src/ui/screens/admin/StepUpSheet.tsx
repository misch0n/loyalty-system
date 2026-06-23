/**
 * StepUpSheet — admin step-up re-auth for destructive/program changes
 * (UX-SPEC §6: "destructive admin actions require step-up re-auth").
 *
 * Renders a kit Sheet + PinPad and verifies the entered PIN against the
 * currently signed-in admin via `useAuth().unlock(pin)` — which only resolves
 * for the SAME actor id, so it doubles as a confirm-it's-really-you gate. On a
 * verified PIN it calls `onConfirm()` and closes. The PIN is never persisted or
 * logged here; verification is delegated to the auth/service layer.
 */

import { useEffect, useState } from 'react';
import { Button, PinPad, Sheet } from '../../kit';
import { useAuth } from '../../app/AuthContext';

export interface StepUpSheetProps {
  open: boolean;
  /** Close without confirming. */
  onClose: () => void;
  /** Called after the PIN verifies as the current admin. */
  onConfirm: () => void | Promise<void>;
  /** Sheet title, e.g. "Confirm program change". */
  title?: string;
  /** One-line explanation of what's being confirmed. */
  message?: string;
}

const PIN_LENGTH = 4;

export function StepUpSheet({
  open,
  onClose,
  onConfirm,
  title = 'Confirm it’s you',
  message = 'Re-enter your PIN to make this change.',
}: StepUpSheetProps) {
  const { unlock } = useAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset entry whenever the sheet opens or closes.
  useEffect(() => {
    setPin('');
    setError(null);
    setBusy(false);
  }, [open]);

  // Auto-verify once a full PIN is entered.
  useEffect(() => {
    if (!open || busy) return;
    if (pin.length < PIN_LENGTH) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    void unlock(pin).then(async (result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.reason ?? 'That PIN didn’t match. Try again.');
        setPin('');
        setBusy(false);
        return;
      }
      try {
        await onConfirm();
      } finally {
        if (!cancelled) setBusy(false);
      }
    });
    return () => {
      cancelled = true;
    };
    // onConfirm is intentionally not a dep: it may be an inline closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, open, busy, unlock]);

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <p className="admin-stepup__msg">{message}</p>
      <PinPad
        value={pin}
        onChange={setPin}
        length={PIN_LENGTH}
        disabled={busy}
        error={error}
      />
      <div className="admin-stepup__actions">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}
