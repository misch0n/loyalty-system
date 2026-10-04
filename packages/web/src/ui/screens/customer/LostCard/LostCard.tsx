/**
 * LostCard — recovery by a typed code (Ckyka reference view 03; SCOPE-DECISIONS
 * §2.3, `UI-RECONCILIATION.md` C2).
 *
 * Two steps on one screen:
 *   1. **Email** → `recovery.request(email)`. The answer is uniform by design
 *      (no account enumeration), so the page always moves on and never says
 *      whether a card matched.
 *   2. **Waiting for the code** — "if that email is on a card, a six-character
 *      code is on its way". The customer types it here, on the device they are
 *      holding: `recovery.consume(email, code)` → on success the server has
 *      already bound *this* device to the card (an HttpOnly cookie), so we only
 *      open it. Every way a code can be wrong — mistyped, expired, used, locked
 *      out after too many tries — is one `null`, and one message that does not
 *      say which. "Send a new code" and "Use a different email" go back round.
 *
 * There is no link any more: a link opens on whichever device reads the mail,
 * which is often the wrong one. Every card has an email (§2.1), so there is no
 * "no email on your card?" path either (C4).
 *
 * Register's `email_in_use` offer arrives here with the address in router
 * location state ({@link LostCardState}) — never in the URL — and prefills it.
 *
 * A discreet gesture-bearing LogoMark sits in the header so the home/staff
 * gestures stay reachable.
 */

import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LogoMark } from '../../../components/Logo/Logo';
import { Eyebrow, Title, Sub } from '../../../components/Heading/Heading';
import { Field } from '../../../components/Field/Field';
import { Button } from '../../../components/Button/Button';
import { GestureLogo } from '../../../app/LogoGestures';
import { ROUTES, cardPath } from '../../../app/routes';
import { useServices } from '../../../common/ServicesContext';
import { isApiError } from '../../../../services/errors';
import './LostCard.css';

/** Router location state another screen may hand `/lost`. */
export interface LostCardState {
  /** Prefills the email step (Register's "Get my card back"). */
  email?: string;
}

/** Mirrors `RECOVERY_EXPIRY_MINUTES` in `packages/server/src/recovery/codes.ts`. */
const CODE_EXPIRY_MINUTES = 15;

type Step = 'email' | 'code';

function prefilledEmail(state: unknown): string {
  if (state && typeof state === 'object' && 'email' in state) {
    const email = (state as LostCardState).email;
    if (typeof email === 'string') return email;
  }
  return '';
}

export function LostCard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { recovery } = useServices();

  const [email, setEmail] = useState(() => prefilledEmail(location.state));
  const [step, setStep] = useState<Step>('email');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function sendCode(again: boolean) {
    if (submitting || !email.trim()) return;
    setSubmitting(true);
    setFormError(null);
    setCodeError(null);
    try {
      await recovery.request(email.trim());
      // Uniform response: move on regardless of whether a card matched.
      setStep('code');
      setCode('');
      setResent(again);
    } catch (err) {
      setFormError(
        failureMessage(err, 'Could not send the code. Check your connection and try again.'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function restore() {
    if (submitting || !code.trim()) return;
    setSubmitting(true);
    setFormError(null);
    setCodeError(null);
    try {
      const restored = await recovery.consume(email.trim(), code);
      if (!restored) {
        setCodeError('That code didn’t work. Check it, or send a new one.');
        return;
      }
      // The server has bound this device to the card; open it.
      navigate(cardPath(restored.token), { replace: true });
    } catch (err) {
      setFormError(
        failureMessage(err, 'Could not check the code. Check your connection and try again.'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  function changeEmail() {
    setStep('email');
    setCode('');
    setCodeError(null);
    setFormError(null);
    setResent(false);
  }

  return (
    <div className="screen bg-cream">
      <div className="screen-pad">
        <div className="lost-head">
          <Button
            variant="ghost"
            className="lost-back"
            onClick={() => navigate(ROUTES.welcome)}
          >
            ← Back
          </Button>
          <GestureLogo>
            <LogoMark size="sm" />
          </GestureLogo>
        </div>

        <Eyebrow>Ckyka rewards</Eyebrow>
        <Title>Lost your card?</Title>

        {step === 'email' ? (
          <>
            <Sub>
              Enter the email on your card and we&apos;ll send a code to bring it back to this
              device.
            </Sub>
            <Field
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="Your email address"
              value={email}
              onChange={setEmail}
              disabled={submitting}
            />
            {formError && (
              <p className="lost-form-error" role="alert">
                {formError}
              </p>
            )}
            <Button
              variant="forest"
              disabled={submitting || !email.trim()}
              onClick={() => void sendCode(false)}
            >
              {submitting ? 'Sending…' : 'Send me a code'}
            </Button>
          </>
        ) : (
          <>
            <p className="lost-sent" role="status">
              If <b>{email.trim()}</b> is on a card, we&apos;ve sent it a 6-character code. Type
              it below to bring your card back to this device. The code expires in{' '}
              {CODE_EXPIRY_MINUTES} minutes.
            </p>
            {resent && (
              <p className="lost-resent" role="status">
                We sent a new code. Use the newest one.
              </p>
            )}
            <div className="lost-code">
              <Field
                label="Code"
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={16}
                placeholder="ABC123"
                value={code}
                onChange={(next) => {
                  setCode(next.toUpperCase());
                  if (codeError) setCodeError(null);
                }}
                aria-invalid={Boolean(codeError)}
                hint={codeError ?? undefined}
                disabled={submitting}
              />
            </div>
            {formError && (
              <p className="lost-form-error" role="alert">
                {formError}
              </p>
            )}
            <Button
              variant="forest"
              disabled={submitting || !code.trim()}
              onClick={() => void restore()}
            >
              {submitting ? 'Checking…' : 'Restore my card'}
            </Button>
            <div className="lost-alt">
              <button
                type="button"
                className="lost-link"
                disabled={submitting}
                onClick={() => void sendCode(true)}
              >
                Send a new code
              </button>
              <button
                type="button"
                className="lost-link"
                disabled={submitting}
                onClick={changeEmail}
              >
                Use a different email
              </button>
            </div>
          </>
        )}

        <div className="spacer" />
      </div>
    </div>
  );
}

export default LostCard;

/**
 * The two refusals a connection hint would get wrong. The `retry-after`
 * countdown on a rate limit is UI-4's (register X2); this only says what
 * happened.
 */
function failureMessage(err: unknown, fallback: string): string {
  if (!isApiError(err)) return fallback;
  if (err.failure.kind === 'rate_limited') {
    return 'Too many tries for now. Wait a few minutes, then try again.';
  }
  if (err.failure.kind === 'forbidden') {
    return 'This device is signed in as a till. Restore your card on your own phone.';
  }
  return fallback;
}
