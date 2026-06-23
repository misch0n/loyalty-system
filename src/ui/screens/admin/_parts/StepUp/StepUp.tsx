/**
 * StepUp — admin re-auth sheet for destructive/program changes (UX-SPEC §6).
 *
 * Reuses the new shared Sheet + PinPad. The entered PIN is verified against the
 * currently signed-in admin via `useAuth().unlock(pin)` (which only resolves for
 * the same actor id), so it doubles as a confirm-it's-really-you gate. On a
 * verified PIN it calls `onConfirm()` and closes. The PIN is never persisted or
 * logged here. Restyled donor equivalent of the old admin/StepUpSheet.
 */
import { useEffect, useState } from 'react';
import { Button } from '../../../../components/Button/Button';
import { PinPad } from '../../../../components/PinPad/PinPad';
import { Sheet } from '../../../../components/Sheet/Sheet';
import { useAuth } from '../../../../app/AuthContext';
import './StepUp.css';

export interface StepUpProps {
  open: boolean;
  /** Close without confirming. */
  onClose: () => void;
  /** Called after the PIN verifies as the current admin. */
  onConfirm: () => void | Promise<void>;
  /** Sheet label, e.g. "Confirm program change". */
  title?: string;
  /** One-line explanation of what's being confirmed. */
  message?: string;
}

const PIN_LENGTH = 4;

export function StepUp({
  open,
  onClose,
  onConfirm,
  title = 'Confirm it’s you',
  message = 'Re-enter your PIN to make this change.',
}: StepUpProps) {
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

  if (!open) return null;

  return (
    <Sheet open={open} onClose={onClose} label={title}>
      <h2 className="stepup-title">{title}</h2>
      <p className="stepup-msg">{message}</p>
      <PinPad value={pin} onChange={setPin} length={PIN_LENGTH} disabled={busy} />
      {error && (
        <p className="stepup-error" role="alert">
          {error}
        </p>
      )}
      <div className="stepup-actions">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}
