/**
 * CardMenu — the card "⋯" sheet: remember / forget / delete / recovery status
 * (UI-SPEC §4.6, UX-SPEC §4.4).
 *
 * Device row (contextual):
 *  - saved on this device  → "Remembered on this device" + Remove from this
 *    device (device-scoped `identity.clear()`; token-only cards confirm first).
 *  - not saved             → Remember this card on this device (`identity.set`).
 *
 * Delete my card → the erasure flow. Per the established self-delete pattern
 * (src/ui/customer/DeleteData.tsx) the destructive action passes the signed-in
 * staff Actor from the session; deletion is staff-confirmed. On a customer device
 * with no staff present, this surfaces the "ask at the till" path rather than
 * inventing an actor. Recovery-status line is derived from PII presence.
 *
 * CardView owns the open state and supplies the customer + saved flag.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Eyebrow, Sheet } from '../../kit';
import { ROUTES } from '../../app/routes';
import { useServices } from '../../common/ServicesContext';
import { useSession } from '../../common/SessionContext';
import type { Customer } from '../../../domain/models';

export interface CardMenuProps {
  open: boolean;
  onClose: () => void;
  customer: Customer;
  /** Whether this card is the one remembered on this device. */
  saved: boolean;
  /** Fired after a remember/remove so CardView can refresh saved-state. */
  onSavedChange: () => void;
}

/** Token-only = no recoverable PII; deletion/removal is unrecoverable. */
function isTokenOnly(c: Customer): boolean {
  return !c.displayName && !c.email && !c.phone;
}

function recoveryLine(c: Customer): string {
  if (c.email) return 'You can restore this card by email if you lose this device.';
  if (c.displayName) return 'No email on file — ask staff to restore this card if it’s lost.';
  return 'This card lives only on this device. There’s no way to restore it if it’s lost.';
}

export function CardMenu({ open, onClose, customer, saved, onSavedChange }: CardMenuProps) {
  const navigate = useNavigate();
  const { identity, customers } = useServices();
  const { actor } = useSession();

  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tokenOnly = isTokenOnly(customer);

  async function remember() {
    setBusy(true);
    setError(null);
    try {
      await identity.set(customer.token);
      onSavedChange();
    } catch {
      setError('Could not save this card to your device. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function removeFromDevice() {
    // Token-only cards can't be recovered — confirm before forgetting.
    if (tokenOnly && !confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await identity.clear();
      onSavedChange();
      setConfirmRemove(false);
    } catch {
      setError('Could not remove this card from your device. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteCard() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    if (!actor) return; // guarded by the UI below
    setBusy(true);
    setError(null);
    try {
      await customers.deleteCustomer(actor, customer.id);
      await identity.clear();
      navigate(ROUTES.welcome, { replace: true });
    } catch {
      setError('Could not delete your card. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Your card">
      <div className="card-menu">
        {error && (
          <p className="screen__error" role="alert">
            {error}
          </p>
        )}

        {/* Device row */}
        <section className="card-menu__section">
          <Eyebrow>This device</Eyebrow>
          {saved ? (
            <>
              <p className="card-menu__status">Remembered on this device.</p>
              {confirmRemove ? (
                <p className="card-menu__confirm">
                  This card can’t be recovered without an email — remove anyway?
                </p>
              ) : null}
              <Button variant="line" block disabled={busy} onClick={removeFromDevice}>
                {confirmRemove ? 'Yes, remove it' : 'Remove from this device'}
              </Button>
            </>
          ) : (
            <>
              <p className="card-menu__status">This card isn’t saved on this device.</p>
              <Button variant="line" block disabled={busy} onClick={remember}>
                Remember this card on this device
              </Button>
            </>
          )}
        </section>

        {/* Recovery status */}
        <section className="card-menu__section">
          <Eyebrow>Recovery</Eyebrow>
          <p className="card-menu__status">{recoveryLine(customer)}</p>
        </section>

        {/* Delete (destructive) */}
        <section className="card-menu__section card-menu__section--danger">
          <Eyebrow tone="terra">Delete</Eyebrow>
          {confirmDelete && (
            <p className="card-menu__confirm">
              This permanently removes your card and any details on it.
              {tokenOnly ? ' This card can’t be recovered — it will be gone for good.' : ''}
            </p>
          )}
          {actor ? (
            <Button variant="line" block className="card-menu__delete" disabled={busy} onClick={deleteCard}>
              {confirmDelete ? 'Yes, delete my card' : 'Delete my card'}
            </Button>
          ) : (
            <p className="card-menu__status">
              A member of staff confirms deletions. Ask at the counter and they’ll remove your card.
            </p>
          )}
        </section>
      </div>
    </Sheet>
  );
}

export default CardMenu;
