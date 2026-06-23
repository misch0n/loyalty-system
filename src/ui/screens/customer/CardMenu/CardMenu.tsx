/**
 * CardMenu — the card "⋯" sheet: remember / forget / delete / recovery status
 * (Ckyka reference view 07).
 *
 * Device row (contextual):
 *  - saved on this device  → "Remembered on this device" + Remove (device-scoped
 *    `identity.clear()`; token-only cards confirm "can't be recovered" first).
 *  - not saved             → "Remember this card" (`identity.set`).
 *
 * Recovery-status line is derived from PII presence. "Delete my card" →
 * self-service erasure via `customers.selfDelete(token)` (the service owns the
 * system actor; the UI never fabricates a staff Actor). Token-only cards confirm
 * with an "unrecoverable" warning first; on success the device identity is
 * cleared and the visitor lands on Welcome.
 *
 * When this device opens a card it does NOT own, a ContextBanner (default OFF)
 * offers to remember it instead of auto-clobbering the saved card.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet, MenuRow, RecoveryLine } from '../../../components/Sheet/Sheet';
import { ContextBanner } from '../../../components/ContextBanner/ContextBanner';
import { Toggle } from '../../../components/Field/Field';
import { ROUTES } from '../../../app/routes';
import { useServices } from '../../../common/ServicesContext';
import type { Customer } from '../../../../domain/models';
import './CardMenu.css';

export interface CardMenuProps {
  open: boolean;
  onClose: () => void;
  customer: Customer;
  /** Whether this card is the one remembered on this device. */
  saved: boolean;
  /** Fired after a remember/remove so the parent can refresh saved-state. */
  onSavedChange: () => void;
  /** Opaque card token (drives delete + remember). */
  token: string;
}

/** Top-left card icon (remembered card). */
const CARD_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M9 7h6" strokeLinecap="round" />
  </svg>
);

/** Trash icon (delete). */
const TRASH_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M6 7h12M9 7V5h6v2M8 7l1 12h6l1-12" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Token-only = no recoverable PII; deletion/removal is unrecoverable. */
function isTokenOnly(c: Customer): boolean {
  return !c.displayName && !c.email && !c.phone;
}

function recoveryLine(c: Customer): string {
  if (c.email) return 'You can restore this card by email.';
  if (c.displayName) return 'No email on file — ask staff to restore this card if it’s lost.';
  return 'This card lives only on this device. There’s no way to restore it if it’s lost.';
}

export function CardMenu({ open, onClose, customer, saved, onSavedChange, token }: CardMenuProps) {
  const navigate = useNavigate();
  const { identity, customers } = useServices();

  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tokenOnly = isTokenOnly(customer);

  async function remember() {
    setBusy(true);
    setError(null);
    try {
      await identity.set(token);
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
    setBusy(true);
    setError(null);
    try {
      await customers.selfDelete(token);
      await identity.clear();
      navigate(ROUTES.welcome, { replace: true });
    } catch {
      setError('Could not delete your card. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const deviceTitle = saved ? 'Remembered on this device' : 'Remember this card';
  const deviceSubtitle = saved
    ? confirmRemove
      ? 'This card can’t be recovered without an email — tap again to remove anyway.'
      : 'Remove to forget it here — this does not delete your card'
    : 'Save this card to this device so it opens automatically';

  const deleteSubtitle = confirmDelete
    ? tokenOnly
      ? 'This card can’t be recovered — tap again to delete it for good.'
      : 'Tap again to permanently erase your card and data.'
    : 'Erases your card and data. Can’t be undone.';

  return (
    <Sheet open={open} onClose={onClose} label="Your card">
      {error && (
        <p className="card-menu-error" role="alert">
          {error}
        </p>
      )}

      <MenuRow
        first
        icon={CARD_ICON}
        title={deviceTitle}
        subtitle={busy ? '…' : deviceSubtitle}
        onClick={saved ? removeFromDevice : remember}
      />

      <RecoveryLine>{recoveryLine(customer)}</RecoveryLine>

      <MenuRow
        danger
        icon={TRASH_ICON}
        title="Delete my card"
        subtitle={deleteSubtitle}
        onClick={deleteCard}
      />

      {!saved && (
        <div className="card-menu-context">
          <ContextBanner
            toggle={
              <Toggle
                on={false}
                onChange={(on) => {
                  if (on) void remember();
                }}
                label="Remember on this device"
              />
            }
          >
            Viewing{' '}
            <b>
              {customer.displayName ? `${customer.displayName}’s` : 'this'}
            </b>{' '}
            card · remember on this device?
          </ContextBanner>
        </div>
      )}
    </Sheet>
  );
}

export default CardMenu;
