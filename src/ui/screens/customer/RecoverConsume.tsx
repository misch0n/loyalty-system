/**
 * RecoverConsume — the recovery magic-link landing (UX-SPEC §5).
 *
 * Opened from the single-use email link `/recover/:code`. Consumes the code via
 * `recovery.redeem(code)`; on `{ token }` it re-seeds `IdentityStore` (only the
 * opaque token) and navigates to the restored card. On `null` the link is
 * invalid/expired/used — instructive copy + the staff path.
 *
 * App wiring routes `/recover/:code` here.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Eyebrow } from '../../kit';
import { ROUTES, cardPath } from '../../app/routes';
import { useServices } from '../../common/ServicesContext';

type Phase = 'working' | 'invalid' | 'error';

export function RecoverConsume() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { recovery, identity } = useServices();

  const [phase, setPhase] = useState<Phase>('working');
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    let active = true;

    void (async () => {
      if (!code) {
        if (active) setPhase('invalid');
        return;
      }
      try {
        const result = await recovery.redeem(code);
        if (!active) return;
        if (!result) {
          setPhase('invalid');
          return;
        }
        await identity.set(result.token);
        navigate(cardPath(result.token), { replace: true });
      } catch {
        if (active) setPhase('error');
      }
    })();

    return () => {
      active = false;
    };
  }, [code, recovery, identity, navigate]);

  if (phase === 'working') {
    return (
      <main className="screen recover safe-inset" aria-busy="true">
        <Eyebrow>Recovery</Eyebrow>
        <h1 className="screen__title">Restoring your card…</h1>
        <p className="screen__sub">One moment while we bring your card back to this device.</p>
      </main>
    );
  }

  return (
    <main className="screen recover safe-inset">
      <header className="screen__head">
        <Eyebrow>Recovery</Eyebrow>
        <h1 className="screen__title">
          {phase === 'error' ? 'Something went wrong' : 'This link can’t be used'}
        </h1>
        <p className="screen__sub">
          {phase === 'error'
            ? 'We couldn’t restore your card just now. Check your connection and request a fresh link.'
            : 'This restore link is invalid or has expired. Links are single-use and time out quickly — request a new one, or ask a member of staff to move your cups onto a fresh card.'}
        </p>
      </header>

      <div className="recover__actions">
        <Button variant="forest" size="lg" block onClick={() => navigate(ROUTES.lost)}>
          Request a new link
        </Button>
        <Button variant="ghost" onClick={() => navigate(ROUTES.welcome)}>
          Back to start
        </Button>
      </div>
    </main>
  );
}

export default RecoverConsume;
