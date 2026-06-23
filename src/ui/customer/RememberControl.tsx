/**
 * RememberControl (B1) — device-scoped "remember this card" persistence on the
 * customer's own card page. A device remembers exactly one card.
 *
 *  - Saved on this device  → "Remove this card from this device" (forget). Clears
 *    only the device entry (not the account); token-only cards confirm first
 *    since they can't be recovered.
 *  - Not saved, nothing else saved → a primary "Remember this card" action.
 *  - Not saved, a DIFFERENT card saved → an explicit "replace the saved card"
 *    action with a warning (protects the already-saved card).
 *
 * It never auto-saves on view — opening someone else's card never silently
 * overwrites your own (family sharing).
 */

import { useCallback, useEffect, useState } from 'react';
import { useServices } from '../common/ServicesContext';

interface Props {
  token: string;
  /** False for token-only cards (no email/name) → confirm before forgetting. */
  recoverable: boolean;
}

export function RememberControl({ token, recoverable }: Props) {
  const { identity } = useServices();
  const [saved, setSaved] = useState<string | null | undefined>(undefined);

  const reload = useCallback(async () => setSaved(await identity.get()), [identity]);
  useEffect(() => {
    reload();
  }, [reload]);

  if (saved === undefined) return null;
  const isSaved = saved === token;
  const hasOther = saved != null && saved !== token;

  async function remember() {
    await identity.set(token);
    await reload();
  }

  async function forget() {
    if (
      !recoverable &&
      !window.confirm(
        "Without an email, this card can't be recovered. Remove it from this device anyway?",
      )
    ) {
      return;
    }
    await identity.clear();
    await reload();
  }

  if (isSaved) {
    return (
      <div className="remember-control">
        <span className="muted small">✓ Saved on this device.</span>
        <button type="button" className="link" onClick={forget}>
          Remove this card from this device
        </button>
      </div>
    );
  }

  return (
    <div className="remember-control">
      {hasOther && (
        <p className="muted small">
          Another card is saved on this device. Remember this one instead? This replaces the card
          currently saved here.
        </p>
      )}
      <button type="button" className={hasOther ? '' : 'primary'} onClick={remember}>
        {hasOther ? 'Replace saved card' : 'Remember this card on this device'}
      </button>
    </div>
  );
}
