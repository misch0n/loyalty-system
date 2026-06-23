/**
 * LostCard — email-based recovery + staff-assisted fallback (UI-SPEC §4.3,
 * UX-SPEC §5).
 *
 * Enter an email → `recovery.request(email)`. The response is uniform by design
 * (no account enumeration), so we ALWAYS show the same confirmation and never
 * reveal whether a card was found. A divider then points token-only / name-only
 * customers to the in-person staff path.
 *
 * App wiring routes `/lost` here.
 */

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Eyebrow, Field } from '../../kit';
import { ROUTES } from '../../app/routes';
import { useServices } from '../../common/ServicesContext';

export function LostCard() {
  const navigate = useNavigate();
  const { recovery } = useServices();

  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
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
    <main className="screen lost safe-inset">
      <header className="screen__head">
        <Eyebrow>Recovery</Eyebrow>
        <h1 className="screen__title">Lost your card?</h1>
        <p className="screen__sub">
          If you added an email, we'll send a single-use link to restore your card on this device.
        </p>
      </header>

      {sent ? (
        <div className="lost__sent" role="status">
          <p>
            If that email is on a card, a restore link is on its way. Open it on this device to bring
            your card back. The link is single-use and expires shortly.
          </p>
          <Button variant="line" onClick={() => setSent(false)}>
            Use a different email
          </Button>
        </div>
      ) : (
        <form className="lost__form" onSubmit={onSubmit} noValidate>
          <Field
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
          />
          {formError && (
            <p className="screen__error" role="alert">
              {formError}
            </p>
          )}
          <Button type="submit" variant="forest" size="lg" block disabled={submitting || !email.trim()}>
            {submitting ? 'Sending…' : 'Send restore link'}
          </Button>
        </form>
      )}

      <hr className="lost__divider" />

      <section className="lost__staff">
        <Eyebrow>No email on your card?</Eyebrow>
        <p>
          Pop in and a member of staff can move your cups onto a fresh card. No email needed — just
          ask at the counter.
        </p>
      </section>

      <Button variant="ghost" onClick={() => navigate(ROUTES.welcome)}>
        Back
      </Button>
    </main>
  );
}

export default LostCard;
