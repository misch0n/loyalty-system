/**
 * CustChip — the "who is being credited" confirmation row (Ckyka view 10,
 * state 2 "resolved").
 *
 * Donor `.cust`: a blush avatar initial (`.av`), the customer name (`.cn`) and a
 * mono progress line (`.cs` "{current} of {total} cups"), and an optional status
 * pill (`.ready`, e.g. "scanned"). Pure presentation — derived numbers in,
 * markup out; no PII is ever logged here.
 */
import './CustChip.css';

export interface CustChipProps {
  name: string;
  /** Coffees earned so far (derived balance toward the reward). */
  current: number;
  /** Reward threshold (cups needed). */
  total: number;
  /** Optional pill text, e.g. "scanned". */
  status?: string;
}

export function CustChip({ name, current, total, status }: CustChipProps): JSX.Element {
  const initial = name.trim().charAt(0).toUpperCase() || '·';
  return (
    <div className="cust">
      <span className="av">{initial}</span>
      <div>
        <div className="cn">{name}</div>
        <div className="cs">
          {current} of {total} cups
        </div>
      </div>
      {status != null && <span className="ready">{status}</span>}
    </div>
  );
}
