/**
 * ProgramEdit — in-app sheet to change a numeric program setting.
 *
 * Replaces the old flow (`window.prompt` for the value), which broke on mobile
 * Safari where `prompt()` is suppressed. The value is a normal Field and the
 * sheet's own Save is the confirmation: it used to ask for the PIN as well, and
 * register A7 (2026-10-03) dropped that with the PIN — the server never
 * enforced it. On Save it calls `onConfirm`.
 */
import { useEffect, useState } from 'react';
import { Button } from '../../../../components/Button/Button';
import { Field } from '../../../../components/Field/Field';
import { Sheet } from '../../../../components/Sheet/Sheet';
import './ProgramEdit.css';

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
  /** Called with the validated new value on Save. */
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
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Pre-fill the current value whenever the sheet opens.
  useEffect(() => {
    if (open) {
      setValue(String(current));
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
    setBusy(true);
    setError(null);
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
