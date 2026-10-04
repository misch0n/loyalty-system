/**
 * Register — self-service "Join the club" (Ckyka reference view 02).
 *
 * One-step registration: name and email, **both required** (SCOPE-DECISIONS
 * §2.1 — a card without a contact address could not be recovered, so token-only
 * cards are gone; NO phone), plus a consent row linking the privacy notice. On
 * submit it calls `customers.selfRegister`; field errors map back to the
 * relevant inputs.
 *
 * `POST /customers` binds this device to the new card itself (an HttpOnly
 * cookie), so on success we only navigate to the card — nothing is written to
 * `IdentityStore` from here. PII never enters the QR, the URL or logs.
 *
 * The server's refusals land on the field that needs fixing, never as a toast:
 *   - `409 email_in_use` — one card per address (§3.4). The email field says so
 *     and offers "Get my card back", which opens `/lost` with the address
 *     prefilled (router location state, never the URL).
 *   - `400 invalid_details` — a blank name or a malformed address the form's
 *     own checks missed; both fields are flagged, since the server does not say
 *     which.
 *   - `429 rate_limited` — the button is disabled and counts the server's
 *     `retry-after` down ("Try again in 45 s"), with one line saying why; both
 *     go when the wait is over (UI-4).
 * Anything else is one sentence under the form from the shared
 * {@link failureMessage}: can't reach (check the connection) is kept apart from
 * the server failing (wait), a till gets "use your own phone", and the fallback
 * blames nobody. None of it is a toast or a banner (X2: action failures stay at
 * the control; the global banner covers connectivity on its own).
 *
 * A discreet gesture-bearing LogoMark sits in the header so the home/staff
 * gestures stay reachable on a screen the reference renders mark-less.
 */

import { useEffect, useState } from 'react';
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
import { failureMessage, retryAfterOf } from '../../../common/failure';
import { formatWait, useRetryCountdown } from '../../../common/useRetryCountdown';
import { isApiError } from '../../../../services/errors';
import { isValidEmail, type FieldError } from '@cafe/shared/domain/validation';
import type { LostCardState } from '../LostCard/LostCard';
import './Register.css';

type FieldName = FieldError['field'];

const CREATE_FAILED = 'Couldn’t create your card. Try again.';

export function Register() {
  const navigate = useNavigate();
  const { customers } = useServices();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [showEmailError, setShowEmailError] = useState(false);
  const [consent, setConsent] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  // The server said this address already has a card (`409 email_in_use`).
  const [emailTaken, setEmailTaken] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // A `rate_limited` refusal: the wait on the button, and why, until it is over.
  const countdown = useRetryCountdown();
  const [limitNote, setLimitNote] = useState<string | null>(null);

  // Inline email-format validation: a typed address must be plausible before we
  // let them submit. A blank one is caught on submit, as a required field.
  const emailInvalid = email.trim() !== '' && !isValidEmail(email);

  // Debounced red-border feedback: while typing, flag an invalid address only
  // after a short pause; clear instantly once the field is empty or valid.
  useEffect(() => {
    const trimmed = email.trim();
    if (trimmed === '' || isValidEmail(trimmed)) {
      setShowEmailError(false);
      return;
    }
    const timer = window.setTimeout(() => setShowEmailError(true), 600);
    return () => window.clearTimeout(timer);
  }, [email]);

  async function onSubmit() {
    if (submitting || countdown.waiting) return;
    if (emailInvalid) {
      setShowEmailError(true);
      return;
    }
    setErrors({});
    setEmailTaken(false);
    setFormError(null);
    setSubmitting(true);
    try {
      const result = await customers.selfRegister({
        displayName: displayName.trim(),
        email: email.trim(),
        consent,
      });

      if (!result.ok || !result.customer) {
        const mapped: Partial<Record<FieldName, string>> = {};
        for (const err of result.errors ?? []) mapped[err.field] = err.message;
        setErrors(mapped);
        return;
      }

      // `POST /customers` has already bound this device to the card.
      navigate(cardPath(result.customer.token), { replace: true });
    } catch (err) {
      if (isApiError(err) && err.failure.kind === 'email_in_use') {
        setEmailTaken(true);
      } else if (isApiError(err) && err.failure.kind === 'rejected' && err.failure.code === 'invalid_details') {
        setErrors({
          displayName: 'Check your name, then try again.',
          email: 'Check your email address, then try again.',
        });
      } else {
        const wait = retryAfterOf(err);
        if (wait !== null) {
          countdown.start(wait);
          setLimitNote(failureMessage(err, CREATE_FAILED));
        } else {
          setFormError(failureMessage(err, CREATE_FAILED));
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  function recoverCard() {
    const state: LostCardState = { email: email.trim() };
    navigate(ROUTES.lost, { state });
  }

  const emailHint = emailTaken
    ? 'This email already has a card.'
    : errors.email ??
      (showEmailError
        ? 'Enter a valid email address.'
        : 'For a code to get your card back, and to tell you when a free coffee is ready.');

  // The rate-limit line lives exactly as long as its countdown.
  const shownError = formError ?? (countdown.waiting ? limitNote : null);

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
        <Sub>Your name and email make the card yours, and let you get it back.</Sub>

        <Field
          label="Name"
          type="text"
          autoComplete="name"
          placeholder="Your name"
          required
          value={displayName}
          onChange={(next) => {
            setDisplayName(next);
            if (errors.displayName) setErrors((e) => ({ ...e, displayName: undefined }));
          }}
          aria-invalid={Boolean(errors.displayName)}
          hint={errors.displayName}
          disabled={submitting}
        />

        <Field
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="Your email address"
          required
          value={email}
          onChange={(next) => {
            setEmail(next);
            setEmailTaken(false);
            if (errors.email) setErrors((e) => ({ ...e, email: undefined }));
          }}
          onBlur={() => setShowEmailError(emailInvalid)}
          aria-invalid={showEmailError || emailTaken || Boolean(errors.email)}
          hint={emailHint}
          disabled={submitting}
        />

        {emailTaken && (
          <div className="register-taken" role="alert">
            <p>One card per email. If it&apos;s yours, we can send a code to bring it back.</p>
            <Button variant="line" onClick={recoverCard}>
              Get my card back
            </Button>
          </div>
        )}

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

        {shownError && (
          <p className="register-form-error" role="alert">
            {shownError}
          </p>
        )}

        <Button
          variant="forest"
          disabled={submitting || emailInvalid || countdown.waiting}
          onClick={onSubmit}
        >
          {submitting
            ? 'Creating your card…'
            : countdown.waiting
              ? `Try again in ${formatWait(countdown.secondsLeft)}`
              : 'Create my card'}
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
