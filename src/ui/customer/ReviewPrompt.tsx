/**
 * ReviewPrompt (B4) — after a customer's FIRST redemption (a positive moment),
 * show a friendly, dismissible prompt that deep-links to the café's Google review
 * dialog. Shown exactly once per device (flagged in localStorage), to everyone —
 * no sentiment gating (Google prohibits it). There is no API to post a review on
 * the user's behalf; this just hands off to Google.
 */

import { useEffect, useState } from 'react';
import { googlePlaceId } from '../../config/env';

const PROMPTED_KEY = 'cafe-loyalty.reviewPrompted';

export function ReviewPrompt({ hasRedemption }: { hasRedemption: boolean }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (hasRedemption && !localStorage.getItem(PROMPTED_KEY)) {
      localStorage.setItem(PROMPTED_KEY, '1'); // only ever once, on the first redemption
      setShow(true);
    }
  }, [hasRedemption]);

  if (!show) return null;

  const reviewUrl = `https://search.google.com/local/writereview?placeid=${encodeURIComponent(
    googlePlaceId,
  )}`;

  return (
    <div className="review-prompt">
      <button
        type="button"
        className="dismiss"
        aria-label="Dismiss"
        onClick={() => setShow(false)}
      >
        ×
      </button>
      <p>🎉 Enjoyed your reward? A quick review would make our day.</p>
      <a
        className="button primary"
        href={reviewUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => setShow(false)}
      >
        Leave a quick review
      </a>
    </div>
  );
}
