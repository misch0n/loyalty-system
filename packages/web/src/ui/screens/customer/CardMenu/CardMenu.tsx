/**
 * CardMenu — the card "⋯" sheet (Ckyka reference view 07).
 *
 * **One entry: "Delete my card"** (`UI-RECONCILIATION.md` C6). The device is
 * bound to the card by an HttpOnly cookie the server sets, and recovery is the
 * only un-bind (SCOPE-DECISIONS §3.2) — so the old remember/remove-from-device
 * row, its recovery-aware remove copy and the "remember on this device?" banner
 * are gone. A customer who finds someone else's card on their phone recovers
 * their own, which replaces it.
 *
 * Tapping the entry "redraws" the sheet into a red-tinted confirmation gated
 * behind a 3-second `HoldButton`. The copy says plainly what deletion does on
 * the server (C5, §3.3): the card, its cups and rewards, and the name and email
 * are erased, and the address is then free to start a new card at zero.
 *
 * Erasure is `customers.selfDelete(token)` — `DELETE /customers/:id`, which
 * accepts the card's own device and writes the audit row from the session; the
 * UI never fabricates an actor. `identity.clear()` (`DELETE /me`) follows,
 * harmless when the server already forgot the card, and we go to welcome.
 *
 * A failed delete says why inside the sheet (`role="alert"`, never a toast) in
 * the shared {@link failureMessage} terms — can't reach, the server failed, an
 * out-of-date page — with "Couldn't delete your card. Try again." for the rest.
 * It does not claim the card survived: a request lost on the way back may have
 * landed.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet, MenuRow } from '../../../components/Sheet/Sheet';
import { HoldButton } from '../../../components/HoldButton/HoldButton';
import { ROUTES } from '../../../app/routes';
import { useServices } from '../../../common/ServicesContext';
import { failureMessage } from '../../../common/failure';
import './CardMenu.css';

export interface CardMenuProps {
  open: boolean;
  onClose: () => void;
  /** Opaque card token (drives delete). */
  token: string;
}

type Mode = 'menu' | 'delete';

const HOLD_MS = 3000;

/** Trash icon (delete). */
const TRASH_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M6 7h12M9 7V5h6v2M8 7l1 12h6l1-12" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function CardMenu({ open, onClose, token }: CardMenuProps) {
  const navigate = useNavigate();
  const { identity, customers } = useServices();

  const [mode, setMode] = useState<Mode>('menu');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Always reopen on the menu, never mid-confirmation.
  useEffect(() => {
    if (open) {
      setMode('menu');
      setError(null);
    }
  }, [open]);

  async function deleteCard() {
    setBusy(true);
    setError(null);
    try {
      await customers.selfDelete(token);
      // Best-effort: the card is already erased, and `GET /me` answers `null`
      // for a deleted card whether or not this device's binding is cleared.
      await identity.clear().catch(() => undefined);
      navigate(ROUTES.welcome, { replace: true });
    } catch (err) {
      setError(failureMessage(err, 'Couldn’t delete your card. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} label="Your card">
      {error && (
        <p className="card-menu-error" role="alert">
          {error}
        </p>
      )}

      {mode === 'menu' && (
        <MenuRow
          first
          danger
          icon={TRASH_ICON}
          title="Delete my card"
          subtitle="tap to delete your card and data permanently."
          onClick={() => setMode('delete')}
        />
      )}

      {mode === 'delete' && (
        <div className="card-confirm">
          <span className="card-confirm-badge">{TRASH_ICON}</span>
          <h2 className="card-confirm-title">Delete your card?</h2>
          <p className="card-confirm-msg">
            This PERMANENTLY erases your card, its cups and rewards, and your name and email.
            <br />
            Your email is then free to start a new card, from zero. This cannot be undone.
          </p>
          <HoldButton holdMs={HOLD_MS} disabled={busy} onConfirm={() => void deleteCard()}>
            DELETE
          </HoldButton>
          <p className="card-confirm-fine">hold button if you are certain</p>
          <button type="button" className="card-confirm-cancel" onClick={() => setMode('menu')}>
            Keep my card
          </button>
        </div>
      )}
    </Sheet>
  );
}

export default CardMenu;
