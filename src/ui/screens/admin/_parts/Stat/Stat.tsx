/**
 * Stat / StatWide — admin "This week" tiles (Ckyka reference view 11).
 *
 * `Stat` is a derived figure tile (`.stat` with `.n` value, `.l` label, and an
 * optional `.delta` caption). `StatWide` is the editable program row
 * (`.stat.wide`) with a label/value pair and a `.edit` "Change" button that the
 * screen wires to a step-up confirm. Pure presentation; the container `.stats`
 * grid is rendered by the screen.
 */
import type { ReactNode } from 'react';
import './Stat.css';

export interface StatProps {
  /** The big figure. */
  n: ReactNode;
  /** Caption under the figure. */
  label: ReactNode;
  /** Optional mono delta line (e.g. "+18 new"). */
  delta?: ReactNode;
}

export function Stat({ n, label, delta }: StatProps) {
  return (
    <div className="stat">
      <div className="n">{n}</div>
      <div className="l">{label}</div>
      {delta != null && <div className="delta">{delta}</div>}
    </div>
  );
}

export interface StatWideProps {
  /** Setting label, e.g. "Reward earned at". */
  setLabel: ReactNode;
  /** Setting value, e.g. "10 coffees". */
  setVal: ReactNode;
  /** Opens the step-up confirm to change this setting. */
  onEdit: () => void;
}

export function StatWide({ setLabel, setVal, onEdit }: StatWideProps) {
  return (
    <div className="stat wide">
      <div>
        <div className="setlabel">{setLabel}</div>
        <div className="setval">{setVal}</div>
      </div>
      <button type="button" className="edit" onClick={onEdit}>
        Change
      </button>
    </div>
  );
}
