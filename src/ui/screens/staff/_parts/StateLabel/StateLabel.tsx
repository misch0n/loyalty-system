/**
 * StateLabel — the mono "state · …" divider used in the staff scan workflow
 * (Ckyka view 10). Donor `.state-label` with its trailing rule. Pure layout.
 */
import type { ReactNode } from 'react';
import './StateLabel.css';

export interface StateLabelProps {
  children: ReactNode;
}

export function StateLabel({ children }: StateLabelProps): JSX.Element {
  return <div className="state-label">{children}</div>;
}
