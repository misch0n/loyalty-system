/**
 * SelfRegister — the self-service registration screen (the primary path).
 *
 * The customer creates their own card on their own device in one step: optional
 * details + consent → a card with QR + add-to-wallet, remembered on this browser
 * via the IdentityStore. No staff, no approval queue. A fully token-only account
 * is allowed. Staff-initiated registration (two-device PeerJS handoff) remains a
 * secondary path on the staff screen.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useServices } from '../common/ServicesContext';
import { PrivacyNotice } from '../common/PrivacyNotice';
import { CardView } from './CardView';
import { validateRegistration, type FieldError } from '../../domain/validation';
import type { Customer } from '../../domain/models';

export function SelfRegister() {
  const { customers, identity } = useServices();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<Customer | null>(null);
  // B1: remember toggle defaults ON with no saved card, OFF if a different card
  // is already saved on this device (protect it).
  const [remember, setRemember] = useState(true);
  const [hasOtherSaved, setHasOtherSaved] = useState(false);

  useEffect(() => {
    identity.get().then((saved) => {
      if (saved) {
        setHasOtherSaved(true);
        setRemember(false);
      }
    });
  }, [identity]);

  function errorFor(field: FieldError['field']): string | undefined {
    return errors.find((e) => e.field === field)?.message;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const details = { displayName, email, phone, consent };
    const found = validateRegistration(details);
    setErrors(found);
    if (found.length > 0) return;

    setSubmitting(true);
    try {
      const result = await customers.selfRegister(details);
      if (!result.ok || !result.customer) {
        setErrors(result.errors ?? [{ field: 'consent', message: 'Could not create your card.' }]);
        return;
      }
      if (remember) await identity.set(result.customer.token); // B1: only if chosen
      setCreated(result.customer);
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <div className="card">
        <h1>Your card is ready</h1>
        <p className="muted">Show the QR at the till to collect points.</p>
        <CardView customer={created} />
      </div>
    );
  }

  // B3 recovery tiers — tell the customer how recoverable this card will be.
  const recoveryNote = email.trim()
    ? '✓ Recoverable: if you lose this device, we can email a link to restore this card.'
    : displayName.trim()
      ? 'Name only: staff can help recover your card (best effort). Add an email for instant self-recovery.'
      : 'Anonymous: this card lives only on this device and can’t be recovered if you lose it.';

  return (
    <div className="card">
      <h1>Join the loyalty scheme</h1>
      <p className="muted">Everything here is optional. You can stay anonymous.</p>
      <form onSubmit={onSubmit}>
        <label>
          Name (optional)
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          {errorFor('displayName') && <span className="error">{errorFor('displayName')}</span>}
        </label>
        <label>
          Email (optional)
          <input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" />
          {errorFor('email') && <span className="error">{errorFor('email')}</span>}
        </label>
        <label>
          Phone (optional)
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
          {errorFor('phone') && <span className="error">{errorFor('phone')}</span>}
        </label>

        <p className={email.trim() ? 'muted small' : 'warn'}>{recoveryNote}</p>

        <PrivacyNotice />

        <label className="checkbox">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          I've read the privacy notice and consent to joining.
        </label>
        {errorFor('consent') && <span className="error">{errorFor('consent')}</span>}

        <label className="checkbox">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Remember this card on this device
        </label>
        {hasOtherSaved && remember && (
          <p className="muted small">This replaces the card currently saved on this device.</p>
        )}

        <button type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Join'}
        </button>
      </form>

      <p className="muted small recover-link">
        Lost your card?&nbsp;<Link to="/recover">Recover it by email</Link>.
      </p>
    </div>
  );
}
