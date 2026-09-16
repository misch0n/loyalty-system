/**
 * RecoverConsume — the recovery magic-link landing (Ckyka recovery flow).
 *
 * Opened from the single-use email link `/recover/:code`. Consumes the code via
 * `recovery.redeem(code)`; on `{ token }` it re-seeds `IdentityStore` (only the
 * opaque token) and navigates to the restored card. On `null` the link is
 * invalid/expired/used — instructive copy + the staff path.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { LogoMark } from '../../../components/Logo/Logo';
import { Eyebrow, Title, Sub } from '../../../components/Heading/Heading';
import { Button } from '../../../components/Button/Button';
import { GestureLogo } from '../../../app/LogoGestures';
import { ROUTES, cardPath } from '../../../app/routes';
import { useServices } from '../../../common/ServicesContext';
import './RecoverConsume.css';

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

  return (
    <div className="screen bg-cream">
      <div className="screen-pad">
        <div className="recover-head">
          <GestureLogo>
            <LogoMark size="sm" />
          </GestureLogo>
        </div>

        {phase === 'working' ? (
          <div aria-busy="true">
            <Eyebrow>Recovery</Eyebrow>
            <Title>Restoring your card…</Title>
            <Sub>One moment while we bring your card back to this device.</Sub>
          </div>
        ) : (
          <>
            <Eyebrow>Recovery</Eyebrow>
            <Title>
              {phase === 'error' ? 'Something went wrong' : 'This link can’t be used'}
            </Title>
            <Sub>
              {phase === 'error'
                ? 'We couldn’t restore your card just now. Check your connection and request a fresh link.'
                : 'This restore link is invalid or has expired. Links are single-use and time out quickly — request a new one, or ask a member of staff to move your cups onto a fresh card.'}
            </Sub>

            <div className="recover-actions stack-sm">
              <Button variant="forest" onClick={() => navigate(ROUTES.lost)}>
                Request a new link
              </Button>
              <Button variant="ghost" onClick={() => navigate(ROUTES.welcome)}>
                Back to start
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default RecoverConsume;
