/**
 * LostCard — email-based recovery + staff-assisted fallback (Ckyka reference
 * view 03).
 *
 * Enter an email → `recovery.request(email)`. The response is uniform by design
 * (no account enumeration), so we ALWAYS show the same confirmation and never
 * reveal whether a card matched. A divider then points token-only / name-only
 * customers to the in-person staff path via a sage ContextBanner.
 *
 * A discreet gesture-bearing LogoMark sits in the header so home/proto/staff
 * gestures stay reachable.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogoMark } from '../../../components/Logo/Logo';
import { Eyebrow, Title, Sub } from '../../../components/Heading/Heading';
import { Field } from '../../../components/Field/Field';
import { Button } from '../../../components/Button/Button';
import { ContextBanner } from '../../../components/ContextBanner/ContextBanner';
import { GestureLogo } from '../../../app/LogoGestures';
import { ROUTES } from '../../../app/routes';
import { useServices } from '../../../common/ServicesContext';
import './LostCard.css';

export function LostCard() {
  const navigate = useNavigate();
  const { recovery } = useServices();

  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit() {
    if (submitting || !email.trim()) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await recovery.request(email.trim());
      // Uniform response: confirm regardless of whether a card matched.
      setSent(true);
    } catch {
      setFormError('Could not send the restore link. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
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
        <Sub>
          Enter the email on your card and we&apos;ll send a link to bring it back to this
          device.
        </Sub>

        {sent ? (
          <p className="lost-sent" role="status">
            If that email is on a card, a restore link is on its way. Open it on this device to
            bring your card back. The link is single-use and expires shortly.
          </p>
        ) : (
          <>
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
              onClick={onSubmit}
            >
              {submitting ? 'Sending…' : 'Send restore link'}
            </Button>
          </>
        )}

        <ContextBanner tone="blush">
          <b>No email on your card?</b>
          <br />
          Email is the only way to bring a card back. A card with no email lives only on the
          device it was made on — if that device is lost, the cups can’t be recovered. Add an
          email from your card’s menu to protect it.
        </ContextBanner>

        <div className="spacer" />
      </div>
    </div>
  );
}

export default LostCard;
