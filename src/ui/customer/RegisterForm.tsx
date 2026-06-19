/**
 * RegisterForm — the customer-device registration view.
 *
 * Reused in two places: embedded as the simulated customer pane on the staff
 * Issue-card screen (LocalBridge), and standalone at /register/:sessionId for a
 * real second device (PeerJS). It joins the transport session, collects OPTIONAL
 * details + consent, and submits them back to staff. A fully token-only account
 * is allowed.
 */

import { useEffect, useState } from 'react';
import { useServices } from '../common/ServicesContext';
import { PrivacyNotice } from '../common/PrivacyNotice';
import { validateRegistration, isTokenOnly, type FieldError } from '../../domain/validation';
import type { RegistrationDetails } from '../../ports/Transport';

interface Props {
  sessionId: string;
  /** Embedded mode hides the standalone framing. */
  embedded?: boolean;
}

export function RegisterForm({ sessionId, embedded }: Props) {
  const { transport } = useServices();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    transport.joinSession(sessionId);
  }, [transport, sessionId]);

  function errorFor(field: FieldError['field']): string | undefined {
    return errors.find((e) => e.field === field)?.message;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const details: RegistrationDetails = { displayName, email, phone, consent };
    const found = validateRegistration(details);
    setErrors(found);
    if (found.length > 0) return;
    await transport.submitRegistration(sessionId, details);
    setSent(true);
  }

  const tokenOnly = isTokenOnly({ displayName, email, phone, consent });

  if (sent) {
    return (
      <div className={embedded ? 'sub-card' : 'card'}>
        <h2>All set</h2>
        <p>Your details went to the till. Staff will hand you your card.</p>
      </div>
    );
  }

  return (
    <div className={embedded ? 'sub-card' : 'card'}>
      <h2>Join the loyalty scheme</h2>
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
            No details given. Your card can't be recovered if you lose your phone,
            and you won't get reward notifications. That's fine — just so you know.
          </p>
        )}

        <PrivacyNotice />

        <label className="checkbox">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          I've read the privacy notice and consent to joining.
        </label>
        {errorFor('consent') && <span className="error">{errorFor('consent')}</span>}

        <button type="submit">Join</button>
      </form>
    </div>
  );
}
