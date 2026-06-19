/** Small progress bar for "x of N toward next reward". */

import type { Progress as ProgressData } from '../../domain/loyalty';

export function ProgressBar({ progress }: { progress: ProgressData }) {
  const { current, threshold, rewardsAvailable } = progress;
  const pct = threshold > 0 ? Math.round((current / threshold) * 100) : 0;
  return (
    <div className="progress">
      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={threshold}
        aria-valuenow={current}
        aria-label="Points toward next reward"
      >
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="progress-label">
        {current} of {threshold} toward the next reward
        {rewardsAvailable > 0 && (
          <strong> · {rewardsAvailable} reward{rewardsAvailable > 1 ? 's' : ''} ready</strong>
        )}
      </p>
    </div>
  );
}
