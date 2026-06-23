/**
 * CardMenu — the card "⋯" sheet (Ckyka reference view 07).
 *
 * Two entries:
 *  - Device row: "Remember this card" (save) when not saved; "Remembered on this
 *    device" (→ remove confirmation) when saved.
 *  - "Delete my card" (→ delete confirmation).
 *
 * Tapping the device row (when saved) or the delete row "redraws" the sheet into
 * a red-tinted confirmation. Remove copy is recovery-aware: a token-only card
 * (no name/email) warns it will be lost and gates the REMOVE behind a 3-second
 * hold; a recoverable card explains how to get it back and removes on a single
 * tap. Deletion is always a 3-second hold. The hold gate is `HoldButton`.
 *
 * Erasure uses `customers.selfDelete(token)` (the service owns the system actor;
 * the UI never fabricates a staff Actor). Removing from a device only clears the
 * local identity link.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet, MenuRow } from '../../../components/Sheet/Sheet';
import { ContextBanner } from '../../../components/ContextBanner/ContextBanner';
import { HoldButton } from '../../../components/HoldButton/HoldButton';
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

type Mode = 'menu' | 'remove' | 'delete';

const HOLD_MS = 3000;

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

/** Recovery-aware copy for removing a saved card from this device. */
function removeMessage(hasName: boolean, hasEmail: boolean): string {
  if (!hasName && !hasEmail) {
    return 'You have not entered any recovery information, your card will be permanently lost!';
  }
  const lines: string[] = [];
  if (hasEmail) {
    lines.push(
      "You can recover your card by selecting 'I already have one' on the landing page and entering your email.",
    );
  }
  if (hasName) {
    lines.push('You can ask staff for assistance to recover your card.');
  }
  return lines.join(' ');
}

export function CardMenu({ open, onClose, customer, saved, onSavedChange, token }: CardMenuProps) {
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

  const hasName = Boolean(customer.displayName);
  const hasEmail = Boolean(customer.email);
  const tokenOnly = !hasName && !hasEmail;

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
    setBusy(true);
    setError(null);
    try {
      await identity.clear();
      onSavedChange();
      setMode('menu');
    } catch {
      setError('Could not remove this card from your device. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteCard() {
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

  return (
    <Sheet open={open} onClose={onClose} label="Your card">
      {error && (
        <p className="card-menu-error" role="alert">
          {error}
        </p>
      )}

      {mode === 'menu' && (
        <>
          <MenuRow
            first
            icon={CARD_ICON}
            title={saved ? 'Remembered on this device' : 'Remember this card'}
            subtitle={
              busy ? '…' : saved ? 'tap to remove from device' : 'tap to save to this device'
            }
            onClick={saved ? () => setMode('remove') : remember}
          />

          <MenuRow
            danger
            icon={TRASH_ICON}
            title="Delete my card"
            subtitle="tap to delete your card and data permanently."
            onClick={() => setMode('delete')}
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
                <b>{customer.displayName ? `${customer.displayName}’s` : 'this'}</b> card · remember
                on this device?
              </ContextBanner>
            </div>
          )}
        </>
      )}

      {mode === 'remove' && (
        <div className="card-confirm danger">
          <p className="card-confirm-msg">{removeMessage(hasName, hasEmail)}</p>
          <HoldButton
            holdMs={tokenOnly ? HOLD_MS : 0}
            disabled={busy}
            onConfirm={() => void removeFromDevice()}
          >
            REMOVE
          </HoldButton>
          {tokenOnly && <p className="card-confirm-fine">hold button if you are certain</p>}
          <button type="button" className="card-confirm-cancel" onClick={() => setMode('menu')}>
            Keep my card
          </button>
        </div>
      )}

      {mode === 'delete' && (
        <div className="card-confirm danger">
          <p className="card-confirm-msg">
            You are about to PERMANENTLY delete both your card and your data. This action cannot be
            undone. Hold the button if you are certain.
          </p>
          <HoldButton holdMs={HOLD_MS} disabled={busy} onConfirm={() => void deleteCard()}>
            DELETE
          </HoldButton>
          <button type="button" className="card-confirm-cancel" onClick={() => setMode('menu')}>
            Keep my card
          </button>
        </div>
      )}
    </Sheet>
  );
}

export default CardMenu;
