/**
 * ContextBanner — contextual prompt strip (Ckyka card-menu "viewing a friend's
 * card" / Lost-card staff fallback).
 *
 * Donor `.context-banner`: a blush gradient by default, with a `sage` tone
 * variant (the inline override Lost-card uses). `children` fills the `.ct` body;
 * an optional `toggle` renders into the `.tog` slot. Pure presentation.
 */
import type { ReactNode } from 'react';
import './ContextBanner.css';

export interface ContextBannerProps {
  children: ReactNode;
  /** Surface tone. Defaults to 'blush'. */
  tone?: 'blush' | 'sage';
  /** Optional control rendered in the `.tog` slot (e.g. a toggle). */
  toggle?: ReactNode;
}

export function ContextBanner({ children, tone = 'blush', toggle }: ContextBannerProps) {
  const cls = ['context-banner', tone === 'sage' ? 'sage' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <div className="ct">{children}</div>
      {toggle != null && <span className="tog">{toggle}</span>}
    </div>
  );
}
