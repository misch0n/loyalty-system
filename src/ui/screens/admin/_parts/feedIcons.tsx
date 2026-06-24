/**
 * Shared admin activity-feed icons + the action→icon mapping. Used by the Admin
 * activity feed and the StatDetail popover so both render the same row style.
 */
import type { FeedTone } from './FeedRow/FeedRow';

export const PersonIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <circle cx="12" cy="8" r="3.4" />
    <path d="M5 20c1.2-3.6 4-5 7-5s5.8 1.4 7 5" strokeLinecap="round" />
  </svg>
);

export const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
  </svg>
);

export const StarIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2l2.4 6.3L21 9l-5 4.2L17.6 20 12 16.4 6.4 20 8 13.2 3 9l6.6-.7z" />
  </svg>
);

export const WarnIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M12 4l9 16H3z" strokeLinejoin="round" />
    <path d="M12 10v4" strokeLinecap="round" />
  </svg>
);

export function feedIcon(tone: FeedTone) {
  switch (tone) {
    case 'add':
      return <PlusIcon />;
    case 'red':
      return <StarIcon />;
    case 'warn':
      return <WarnIcon />;
    default:
      return <PersonIcon />;
  }
}
