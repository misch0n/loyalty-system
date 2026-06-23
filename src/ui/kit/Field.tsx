/**
 * Field — labelled input with an optional "(optional)" mono tag and a hint line
 * (UI-SPEC §3, §4.2). Plus ConsentRow, the checkbox variant used for the
 * privacy-notice consent.
 *
 * Pure presentation: forwards input attributes, generates ids for label/hint
 * wiring. No service calls.
 */
import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

export interface FieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  /** Visible label text. */
  label: ReactNode;
  /** Shows the mono "(optional)" tag after the label. */
  optional?: boolean;
  /** Hint / helper line below the input. */
  hint?: ReactNode;
  /** Marks the field invalid and styles the hint as an error. */
  error?: boolean;
  /** Override the generated input id. */
  id?: string;
  /** Class on the wrapping field block. */
  className?: string;
}

export function Field({
  label,
  optional = false,
  hint,
  error = false,
  id,
  className,
  ...inputProps
}: FieldProps) {
  const reactId = useId();
  const inputId = id ?? `field-${reactId}`;
  const hintId = hint != null ? `${inputId}-hint` : undefined;
  const cls = ['kit-field', error ? 'kit-field--error' : '', className].filter(Boolean).join(' ');

  return (
    <div className={cls}>
      <label className="kit-field__label" htmlFor={inputId}>
        <span className="kit-field__label-text">{label}</span>
        {optional && <span className="kit-field__optional">(optional)</span>}
      </label>
      <input
        id={inputId}
        className="kit-field__input"
        aria-invalid={error || undefined}
        aria-describedby={hintId}
        {...inputProps}
      />
      {hint != null && (
        <p id={hintId} className="kit-field__hint">
          {hint}
        </p>
      )}
    </div>
  );
}

export interface ConsentRowProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> {
  /** The consent statement (may include a link to the privacy notice). */
  children: ReactNode;
  id?: string;
  className?: string;
}

export function ConsentRow({ children, id, className, ...inputProps }: ConsentRowProps) {
  const reactId = useId();
  const inputId = id ?? `consent-${reactId}`;
  const cls = ['kit-consent', className].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <input id={inputId} className="kit-consent__box" type="checkbox" {...inputProps} />
      <label className="kit-consent__label" htmlFor={inputId}>
        {children}
      </label>
    </div>
  );
}
