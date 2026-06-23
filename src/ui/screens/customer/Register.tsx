/**
 * Register — self-service "Join the club" (UI-SPEC §4.2, UX-SPEC §4.1).
 *
 * One-step registration: optional name + email (NO phone), a consent row linking
 * the privacy notice, and the honest device-only caveat. On submit it calls
 * `customers.selfRegister`; field errors map back to the relevant inputs. On
 * success, remember-on-this-device is ON by default (Appendix B): the new token
 * is written to `IdentityStore` and we navigate to the card.
 *
 * PII never enters the QR or logs — only the opaque token reaches IdentityStore.
 */

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Eyebrow, Field, ConsentRow } from '../../kit';
import { cardPath } from '../../app/routes';
import { useServices } from '../../common/ServicesContext';
import { PrivacyNotice } from '../../common/PrivacyNotice';
import type { FieldError } from '../../../domain/validation';

type FieldName = FieldError['field'];

export function Register() {
  const navigate = useNavigate();
  const { customers, identity } = useServices();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setErrors({});
    setFormError(null);
    setSubmitting(true);
    try {
      const result = await customers.selfRegister({
        displayName: displayName.trim() || undefined,
        email: email.trim() || undefined,
        consent,
      });

      if (!result.ok || !result.customer) {
        const mapped: Partial<Record<FieldName, string>> = {};
        for (const err of result.errors ?? []) mapped[err.field] = err.message;
        setErrors(mapped);
        return;
      }

      // Remember = ON by default with no card saved (Appendix B): only the
      // opaque token is persisted, never PII.
      await identity.set(result.customer.token);
      navigate(cardPath(result.customer.token), { replace: true });
    } catch {
      setFormError('Could not create your card. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="screen register safe-inset">
      <header className="screen__head">
        <Eyebrow>Join the club</Eyebrow>
        <h1 className="screen__title">Join the club</h1>
        <p className="screen__sub">One tap is enough.</p>
      </header>

      <form className="register__form" onSubmit={onSubmit} noValidate>
        <Field
          label="Name"
          optional
          type="text"
          autoComplete="name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          error={Boolean(errors.displayName)}
          hint={errors.displayName}
          disabled={submitting}
        />

        <Field
          label="Email"
          optional
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={Boolean(errors.email)}
          hint={errors.email ?? 'So we can tell you when a free coffee is ready.'}
          disabled={submitting}
        />

        <PrivacyNotice />

        <ConsentRow
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          disabled={submitting}
        >
          I've read the privacy notice and agree to join.
        </ConsentRow>
        {errors.consent && <p className="screen__field-error" role="alert">{errors.consent}</p>}

        <p className="register__caveat">
          No email means your card lives only on this device — we can't restore it if it's lost.
        </p>

        {formError && (
          <p className="screen__error" role="alert">
            {formError}
          </p>
        )}

        <Button type="submit" variant="forest" size="lg" block disabled={submitting}>
          {submitting ? 'Creating your card…' : 'Create my card'}
        </Button>
      </form>
    </main>
  );
}

export default Register;
