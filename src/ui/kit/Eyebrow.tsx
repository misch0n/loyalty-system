/**
 * Eyebrow — a small mono, uppercase, letter-spaced label.
 * Used above titles and as section kickers (UI-SPEC §1: DM Mono utility).
 */
import type { ReactNode } from 'react';

export interface EyebrowProps {
  children: ReactNode;
  /** Optional extra class names. */
  className?: string;
  /** Tone of the label; defaults to soft ink. */
  tone?: 'default' | 'sage' | 'terra' | 'onForest';
}

export function Eyebrow({ children, className, tone = 'default' }: EyebrowProps) {
  const cls = ['kit-eyebrow', `kit-eyebrow--${tone}`, className].filter(Boolean).join(' ');
  return <span className={cls}>{children}</span>;
}
