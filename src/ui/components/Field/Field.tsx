import type { ChangeEvent, InputHTMLAttributes, ReactNode } from 'react';
import './Field.css';

const CHECK_SVG = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5}>
    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export interface FieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  label: ReactNode;
  optional?: boolean;
  hint?: ReactNode;
  value?: string;
  onChange?: (value: string) => void;
  type?: InputHTMLAttributes<HTMLInputElement>['type'];
}

/**
 * A labelled text input (`.field`). The donor mock renders `.ip` as a faux div;
 * here it is a real wired `<input class="ip">` styled identically.
 */
export function Field({ label, optional, hint, value, onChange, type, ...rest }: FieldProps) {
  return (
    <div className="field">
      <label>
        {label}
        {optional ? <span className="opt">optional</span> : null}
      </label>
      <input
        className="ip"
        type={type ?? 'text'}
        value={value}
        onChange={
          onChange ? (e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value) : undefined
        }
        {...rest}
      />
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export interface ConsentProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}

/**
 * A consent checkbox (`.consent`): the filled `.box` check plus inline label
 * text. The whole row toggles on click.
 */
export function Consent({ checked, onChange, children }: ConsentProps) {
  return (
    <button
      type="button"
      className="consent"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        background: 'transparent',
        border: 0,
        textAlign: 'left',
        cursor: 'pointer',
        padding: 0,
        font: 'inherit',
        width: '100%',
      }}
    >
      <span className="box" style={{ opacity: checked ? 1 : 0.3 }}>
        {CHECK_SVG}
      </span>
      <span>{children}</span>
    </button>
  );
}

export interface ToggleProps {
  on: boolean;
  onChange: (on: boolean) => void;
  label?: ReactNode;
}

/** The small reusable toggle box (`.toggle-box`, `.on` when active). */
export function Toggle({ on, onChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={typeof label === 'string' ? label : undefined}
      onClick={() => onChange(!on)}
      style={{
        background: 'transparent',
        border: 0,
        cursor: 'pointer',
        padding: 0,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <span className={on ? 'toggle-box on' : 'toggle-box'} />
      {label ? <span>{label}</span> : null}
    </button>
  );
}
