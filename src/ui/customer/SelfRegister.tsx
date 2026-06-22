/**
 * SelfRegister — the self-service registration screen (the primary path).
 *
 * The customer creates their own card on their own device in one step: optional
 * details + consent → a card with QR + add-to-wallet, remembered on this browser
 * via the IdentityStore. No staff, no approval queue. A fully token-only account
 * is allowed. Staff-initiated registration (two-device PeerJS handoff) remains a
 * secondary path on the staff screen.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useServices } from '../common/ServicesContext';
import { PrivacyNotice } from '../common/PrivacyNotice';
import { CardView } from './CardView';
import { validateRegistration, isTokenOnly, type FieldError } from '../../domain/validation';
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
      await identity.set(result.customer.token); // remember this browser
      setCreated(result.customer);
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <div className="card">
        <h1>Your card is ready</h1>
        <p className="muted">Saved on this device — just reopen this page to find it again.</p>
        <CardView customer={created} />
      </div>
    );
  }

  const tokenOnly = isTokenOnly({ displayName, email, phone, consent });

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

        {tokenOnly && (
          <p className="warn">
            No details given. Your card can't be recovered if you lose this device,
            and you won't get reward emails. That's fine — just so you know.
          </p>
        )}

        <PrivacyNotice />

        <label className="checkbox">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          I've read the privacy notice and consent to joining.
        </label>
        {errorFor('consent') && <span className="error">{errorFor('consent')}</span>}

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
