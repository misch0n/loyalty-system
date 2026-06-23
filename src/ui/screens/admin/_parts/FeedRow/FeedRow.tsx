/**
 * FeedRow / SectionH / Feed — admin activity & staff feed rows (reference 11).
 *
 * `SectionH` is the mono section kicker (`.section-h`). `Feed` is the bordered
 * list container (`.feed`). `FeedRow` is one row (`.row.<tone>`): a tinted icon
 * chip (`.ri`), a primary label with an optional muted secondary `<span>`
 * (`.rt`), and a trailing mono time (`.rtime`). Tone picks the icon tint:
 * add (sage) · red (blush) · new (forest) · warn (terra). Pure presentation.
 */
import type { ReactNode } from 'react';
import './FeedRow.css';

export type FeedTone = 'add' | 'red' | 'new' | 'warn';

export interface FeedRowProps {
  tone: FeedTone;
  /** Icon node (an inline svg sized by `.ri svg`). */
  icon: ReactNode;
  /** Primary text; pass a `<span>` inside for the muted secondary part. */
  text: ReactNode;
  /** Trailing mono caption (e.g. "2m" or "reset PIN"). */
  time: ReactNode;
}

export function FeedRow({ tone, icon, text, time }: FeedRowProps) {
  return (
    <div className={`row ${tone}`}>
      <span className="ri">{icon}</span>
      <div className="rt">{text}</div>
      <span className="rtime">{time}</span>
    </div>
  );
}

export function SectionH({ children }: { children: ReactNode }) {
  return <div className="section-h">{children}</div>;
}

export function Feed({ children }: { children: ReactNode }) {
  return <div className="feed">{children}</div>;
}
