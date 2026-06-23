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
import { Sheet } from '../../../components/Sheet/Sheet';
import { GestureLogo } from '../../../app/LogoGestures';
import { ROUTES, cardPath } from '../../../app/routes';
import { useServices } from '../../../common/ServicesContext';
import { PrivacyNotice } from '../../../common/PrivacyNotice';
import { isValidEmail, type FieldError } from '../../../../domain/validation';
import './Register.css';

type FieldName = FieldError['field'];

export function Register() {
  const navigate = useNavigate();
  const { customers, identity } = useServices();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [consent, setConsent] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Inline email-format validation (email is optional, but if entered it must be
  // a plausible address before we let them submit).
  const emailInvalid = email.trim() !== '' && !isValidEmail(email);

  async function onSubmit() {
    if (submitting) return;
    if (emailInvalid) {
      setEmailTouched(true);
      return;
    }
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
          <Button
            variant="ghost"
            className="register-back"
            onClick={() => navigate(ROUTES.welcome)}
          >
            ← Back
          </Button>
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
          placeholder="Your name"
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
          placeholder="Your email address"
          value={email}
          onChange={(next) => {
            setEmail(next);
            if (errors.email) setErrors((e) => ({ ...e, email: undefined }));
          }}
          onBlur={() => setEmailTouched(true)}
          aria-invalid={emailTouched && emailInvalid}
          hint={
            errors.email ??
            (emailTouched && emailInvalid
              ? 'Enter a valid email, or leave it blank.'
              : 'So we can tell you when a free coffee is ready.')
          }
          disabled={submitting}
        />

        <Consent checked={consent} onChange={setConsent}>
          I agree to the{' '}
          <button
            type="button"
            className="privacy-link"
            onClick={() => setShowPrivacy(true)}
          >
            privacy notice
          </button>
          . We keep only what&apos;s needed.
        </Consent>
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

        <Button variant="forest" disabled={submitting || emailInvalid} onClick={onSubmit}>
          {submitting ? 'Creating your card…' : 'Create my card'}
        </Button>
      </div>

      <Sheet
        open={showPrivacy}
        onClose={() => setShowPrivacy(false)}
        label="Privacy notice and terms"
      >
        <PrivacyNotice />
      </Sheet>
    </div>
  );
}

export default Register;
