/**
 * IssueCard — staff-side card issuance + the registration handoff (secondary
 * path; self-registration is primary).
 *
 * Staff start a card (creates a token-only shell + a PeerJS session) and show
 * the registration QR. The customer opens it on THEIR OWN phone, which connects
 * back over PeerJS/TURN and submits their details. Duplicate details warn before
 * a second card is created; finalize records consent + writes the audit entry,
 * then the finished card is shown for the customer to save / add to wallet.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useServices } from '../common/ServicesContext';
import { useSession } from '../common/SessionContext';
import { QrDisplay } from '../common/QrDisplay';
import { CardView } from '../customer/CardView';
import { registrationPayload } from '../../qr/encode';
import type { RegistrationDetails } from '../../ports/Transport';
import type { Customer } from '../../domain/models';

type Phase = 'idle' | 'awaiting' | 'review-duplicates' | 'done';

export function IssueCard() {
  const { customers, transport } = useServices();
  const { actor } = useSession();

  const [phase, setPhase] = useState<Phase>('idle');
  const [session, setSession] = useState<{ id: string; joinPayload: string } | null>(null);
  const [joined, setJoined] = useState(false);
  const [pending, setPending] = useState<{ details: RegistrationDetails; duplicates: Customer[] } | null>(
    null,
  );
  const [finished, setFinished] = useState<Customer | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Shell customer + active session id, read inside transport callbacks.
  const customerIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const handleSubmitted = useCallback(
    async (sessionId: string, details: RegistrationDetails) => {
      if (sessionId !== sessionIdRef.current) return;
      const duplicates = await customers.checkDuplicates(details);
      if (duplicates.length > 0) {
        setPending({ details, duplicates });
        setPhase('review-duplicates');
      } else {
        await finalize(details);
      }
    },
    // finalize is stable enough for the prototype; deps kept minimal on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [customers],
  );

  // Register transport listeners once.
  useEffect(() => {
    transport.onCustomerJoined((sessionId) => {
      if (sessionId === sessionIdRef.current) setJoined(true);
    });
    transport.onCustomerSubmitted(handleSubmitted);
  }, [transport, handleSubmitted]);

  async function startCard() {
    if (!actor) return;
    setError(null);
    setJoined(false);
    setFinished(null);
    setPending(null);
    try {
      const shell = await customers.issueCard(actor);
      customerIdRef.current = shell.id;
      const reg = await transport.createRegistrationSession();
      sessionIdRef.current = reg.sessionId;
      setSession({ id: reg.sessionId, joinPayload: reg.joinPayload });
      setPhase('awaiting');
    } catch {
      setError('Could not start a card. Try again.');
    }
  }

  async function finalize(details: RegistrationDetails) {
    const id = customerIdRef.current;
    if (!actor || !id) return;
    const result = await customers.finalizeRegistration(actor, id, details);
    if (!result.ok || !result.customer) {
      setError('Registration details were invalid.');
      return;
    }
    if (sessionIdRef.current) transport.close(sessionIdRef.current);
    setFinished(result.customer);
    setPhase('done');
  }

  function reset() {
    customerIdRef.current = null;
    sessionIdRef.current = null;
    setSession(null);
    setJoined(false);
    setPending(null);
    setFinished(null);
    setPhase('idle');
  }

  const registrationUrl = session ? registrationPayload(session.joinPayload) : '';

  return (
    <div className="screen issue-card">
      <h1>Issue a card</h1>

      {phase === 'idle' && (
        <div className="card">
          <p>
            Most customers join themselves. Use this only on request — start a card,
            then have the customer scan the code with their phone to fill in details.
          </p>
          <button type="button" onClick={startCard} disabled={!actor}>
            Start card
          </button>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {phase === 'awaiting' && session && (
        <div className="card staff-side">
          <h2>At the till</h2>
          <QrDisplay
            payload={registrationUrl}
            label="Registration QR"
            caption="Customer scans this with their phone to join"
          />
          <p className={joined ? 'status joined' : 'status waiting'}>
            {joined
              ? 'Customer connected — waiting for their details…'
              : 'Waiting for the customer to scan and connect…'}
          </p>
          <button type="button" className="link" onClick={reset}>
            Cancel
          </button>
        </div>
      )}

      {phase === 'review-duplicates' && pending && (
        <div className="card warn-card">
          <h2>Possible duplicate</h2>
          <p>
            Details match {pending.duplicates.length} existing card
            {pending.duplicates.length > 1 ? 's' : ''}. Create a new one anyway?
          </p>
          <ul>
            {pending.duplicates.map((c) => (
              <li key={c.id}>{c.displayName || c.email || c.phone || 'existing card'}</li>
            ))}
          </ul>
          <div className="actions-row">
            <button type="button" className="primary" onClick={() => finalize(pending.details)}>
              Create anyway
            </button>
            <button type="button" className="link" onClick={reset}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === 'done' && finished && (
        <div className="card">
          <h2>Card created</h2>
          <CardView customer={finished} />
          <button type="button" onClick={reset}>
            Issue another card
          </button>
        </div>
      )}
    </div>
  );
}
