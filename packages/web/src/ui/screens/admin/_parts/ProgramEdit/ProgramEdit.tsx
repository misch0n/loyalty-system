/**
 * ProgramEdit — in-app sheet to change a numeric program setting.
 *
 * Replaces the old flow (`window.prompt` for the value), which broke on mobile
 * Safari where `prompt()` is suppressed. The value is a normal Field and the
 * sheet's own Save is the confirmation: it used to ask for the PIN as well, and
 * register A7 (2026-10-03) dropped that with the PIN — the server never
 * enforced it. On Save it calls `onConfirm`.
 *
 * **Bounds (register A4).** `min` and `max` come from the same table the server
 * clamps with (`CONFIG_BOUNDS`, `@cafe/shared/domain/config`), so the field
 * cannot hold a value the server would silently change: the range is printed
 * under the field, an out-of-range number says so as it is typed, and Save stays
 * disabled until the value is a whole number inside it.
 *
 * **Errors stay on the editor.** If `onConfirm` throws, the sheet stays open
 * with the admin's value still in the field and a sentence saying what went
 * wrong — never a toast (X2: an action failure belongs on the control that
 * caused it). A server refusal names nothing but its code, so the sentence for
 * a `rejected` answer restates the range this editor enforces.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../../../../components/Button/Button';
import { Field } from '../../../../components/Field/Field';
import { Sheet } from '../../../../components/Sheet/Sheet';
import { isApiError } from '../../../../../services/errors';
import { adminFailureMessage } from '../adminFailure';
import './ProgramEdit.css';

export interface ProgramEditProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Label for the value field, e.g. "Drinks for a free one". */
  fieldLabel: string;
  /** Optional line under the field explaining what the value controls. */
  hint?: ReactNode;
  /** Current value, pre-filled. */
  current: number;
  /** Smallest allowed value — the server's floor for this field. */
  min: number;
  /** Largest allowed value — the server's ceiling for this field. */
  max: number;
  /**
   * Called with the validated new value on Save. Resolve to close; throw to keep
   * the sheet open and report the failure on it.
   */
  onConfirm: (value: number) => void | Promise<void>;
}

/** The same pause Register waits before flagging a half-typed email. */
const RANGE_MESSAGE_DELAY_MS = 600;

/** The range, as a sentence fragment. */
function rangeText(min: number, max: number): string {
  return `${min} to ${max}`;
}

/**
 * What went wrong with a save, in words the admin can act on. Offline, server,
 * out-of-date-page, signed-out and rate-limit wording is the admin-wide one
 * (`adminFailure.ts`); only a refused value is this editor's own to explain.
 */
function describeSaveError(err: unknown, min: number, max: number): string | null {
  const rejected =
    isApiError(err) && err.failure.kind === 'rejected' && err.failure.code === 'rejected_field'
      ? 'That setting can’t be changed here.'
      : `The server didn’t accept that value. Enter a whole number from ${rangeText(min, max)}.`;
  return adminFailureMessage(err, 'Couldn’t save that change. Try again.', { rejected });
}

export function ProgramEdit({
  open,
  onClose,
  title,
  fieldLabel,
  hint,
  current,
  min,
  max,
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

  const trimmed = value.trim();
  const parsed = Number(trimmed);
  const valueOk = trimmed !== '' && Number.isInteger(parsed) && parsed >= min && parsed <= max;

  // Said after a short pause in typing, so the admin never has to press Save to
  // find out — but typing "15" against a floor of 2 does not flash (and a screen
  // reader does not announce) an error after the "1". Save is disabled meanwhile.
  const [showRange, setShowRange] = useState(false);
  useEffect(() => {
    if (trimmed === '' || valueOk) {
      setShowRange(false);
      return;
    }
    const timer = window.setTimeout(() => setShowRange(true), RANGE_MESSAGE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [trimmed, valueOk]);
  const message =
    error ?? (showRange && !valueOk ? `Enter a whole number from ${rangeText(min, max)}.` : null);

  async function save() {
    if (busy) return;
    if (!valueOk) {
      setError(`Enter a whole number from ${rangeText(min, max)}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(parsed);
    } catch (err) {
      // Keep the sheet and the typed value; say what happened here.
      setError(describeSaveError(err, min, max));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const rangeHint = `From ${rangeText(min, max)}.`;

  return (
    <Sheet open={open} onClose={onClose} label={title}>
      <div className="progedit">
        <h2 className="progedit-title">{title}</h2>
        <Field
          label={fieldLabel}
          type="text"
          inputMode="numeric"
          // A digit more than the ceiling has can only be out of range.
          maxLength={String(max).length}
          value={value}
          onChange={(v) => {
            setError(null);
            setValue(v.replace(/[^\d]/g, ''));
          }}
          disabled={busy}
          hint={
            hint ? (
              <>
                {hint} {rangeHint}
              </>
            ) : (
              rangeHint
            )
          }
        />
        {message && (
          <p className="progedit-error" role="alert">
            {message}
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
