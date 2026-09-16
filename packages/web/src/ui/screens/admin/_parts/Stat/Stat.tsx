/**
 * StatWide — the editable program row (`.stat.wide`): a label/value pair and a
 * `.edit` "Change" button the screen wires to a step-up confirm.
 *
 * The derived figure tile that used to live here went with the stats surface
 * (UI-0, SCOPE-DECISIONS §1 FE-A-02/03). Pure presentation; the container
 * `.stats` grid is rendered by the screen.
 */
import type { ReactNode } from 'react';
import './Stat.css';

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
