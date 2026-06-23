/**
 * Register — self-service "Join the club" (Ckyka reference view 02).
 *
 * One-step registration: optional name + email (NO phone), a consent row
 * linking the privacy notice, and the honest device-only caveat. On submit it
 * calls `customers.selfRegister`; field errors map back to the relevant inputs.
 * On success the new token is written to `IdentityStore` (remember = ON by
 * default) and we navigate to the card. PII never enters the QR or logs — only
 * the opaque token reaches IdentityStore.
 *
 * A discreet gesture-bearing LogoMark sits in the header so home/proto/staff
 * gestures stay reachable on a screen the reference renders mark-less.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogoMark } from '../../../components/Logo/Logo';
import { Eyebrow, Title, Sub } from '../../../components/Heading/Heading';
import { Field, Consent } from '../../../components/Field/Field';
import { Button } from '../../../components/Button/Button';
import { GestureLogo } from '../../../app/LogoGestures';
import { cardPath } from '../../../app/routes';
import { useServices } from '../../../common/ServicesContext';
import { PrivacyNotice } from '../../../common/PrivacyNotice';
import type { FieldError } from '../../../../domain/validation';
import './Register.css';

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

  async function onSubmit() {
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

      // Remember = ON by default (no card saved yet): only the opaque token is
      // persisted, never PII.
      await identity.set(result.customer.token);
      navigate(cardPath(result.customer.token), { replace: true });
    } catch {
      setFormError('Could not create your card. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="screen bg-cream">
      <div className="screen-pad">
        <div className="register-head">
          <GestureLogo>
            <LogoMark size="sm" />
          </GestureLogo>
        </div>

        <Eyebrow>Ckyka rewards</Eyebrow>
        <Title>Join the club</Title>
        <Sub>
          One tap is enough. Add details only if you&apos;d like reminders and a way to get
          your card back.
        </Sub>

        <Field
          label="Name"
          optional
          type="text"
          autoComplete="name"
          placeholder="Maria"
          value={displayName}
          onChange={setDisplayName}
          hint={errors.displayName}
          disabled={submitting}
        />

        <Field
          label="Email"
          optional
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="maria@…"
          value={email}
          onChange={setEmail}
          hint={errors.email ?? 'So we can tell you when a free coffee is ready.'}
          disabled={submitting}
        />

        <Consent checked={consent} onChange={setConsent}>
          I agree to the privacy notice. We keep only what&apos;s needed.
        </Consent>
        <div className="register-privacy">
          <PrivacyNotice />
        </div>
        {errors.consent && (
          <p className="register-field-error" role="alert">
            {errors.consent}
          </p>
        )}

        <p className="hint register-caveat">
          No email means your card lives only on this device — we can&apos;t restore it if
          it&apos;s lost.
        </p>

        {formError && (
          <p className="register-form-error" role="alert">
            {formError}
          </p>
        )}

        <Button variant="forest" disabled={submitting} onClick={onSubmit}>
          {submitting ? 'Creating your card…' : 'Create my card'}
        </Button>
      </div>
    </div>
  );
}

export default Register;
