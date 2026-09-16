/**
 * ProgramEdit — in-app sheet to change a numeric program setting + confirm by PIN.
 *
 * Replaces the old flow (StepUp PIN → `window.prompt` for the value), which broke
 * on mobile Safari where `prompt()` is suppressed — so "enter PIN, nothing
 * happens". Here the value is a normal Field and the PIN re-auth runs in-app via
 * `useAuth().unlock` (verifies the same admin). On success it calls `onConfirm`.
 */
import { useEffect, useState } from 'react';
import { Button } from '../../../../components/Button/Button';
import { Field } from '../../../../components/Field/Field';
import { PinPad } from '../../../../components/PinPad/PinPad';
import { Sheet } from '../../../../components/Sheet/Sheet';
import { useAuth } from '../../../../app/AuthContext';
import './ProgramEdit.css';

const PIN_LENGTH = 4;

export interface ProgramEditProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Label for the value field, e.g. "Reward earned at how many coffees?". */
  fieldLabel: string;
  /** Current value, pre-filled. */
  current: number;
  /** Smallest allowed value (default 1). */
  min?: number;
  /** Called with the validated new value after the PIN verifies. */
  onConfirm: (value: number) => void | Promise<void>;
}

export function ProgramEdit({
  open,
  onClose,
  title,
  fieldLabel,
  current,
  min = 1,
  onConfirm,
}: ProgramEditProps) {
  const { unlock } = useAuth();
  const [value, setValue] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Pre-fill the current value and clear the PIN whenever the sheet opens.
  useEffect(() => {
    if (open) {
      setValue(String(current));
      setPin('');
      setError(null);
      setBusy(false);
    }
  }, [open, current]);

  const parsed = Number(value.trim());
  const valueOk = Number.isFinite(parsed) && parsed >= min;

  async function save() {
    if (busy) return;
    if (!valueOk) {
      setError(`Enter a whole number of at least ${min}.`);
      return;
    }
    if (pin.length < PIN_LENGTH) {
      setError('Enter your 4-digit PIN to confirm.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await unlock(pin);
    if (!result.ok) {
      setError(result.reason ?? 'That PIN didn’t match. Try again.');
      setPin('');
      setBusy(false);
      return;
    }
    try {
      await onConfirm(parsed);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <Sheet open={open} onClose={onClose} label={title}>
      <div className="progedit">
        <h2 className="progedit-title">{title}</h2>
        <Field
          label={fieldLabel}
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(v) => {
            setError(null);
            setValue(v.replace(/[^\d]/g, ''));
          }}
          disabled={busy}
        />
        <p className="progedit-msg">Re-enter your PIN to confirm.</p>
        <PinPad value={pin} onChange={setPin} length={PIN_LENGTH} disabled={busy} />
        {error && (
          <p className="progedit-error" role="alert">
            {error}
          </p>
        )}
        <div className="progedit-actions">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="forest" onClick={() => void save()} disabled={busy || !valueOk}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

export default ProgramEdit;
