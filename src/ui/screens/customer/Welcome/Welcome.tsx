/**
 * Welcome — unrecognized-visitor landing (Ckyka reference view 01).
 *
 * Scrolls. Above the fold: a FOREST hero (`.bg-forest`) with the logo lockup,
 * the headline, the two entry actions, and a "scroll" hint. Below the fold: the
 * cream "Find us" café profile from static config (no data dependency).
 *
 * Navigation only — `useNavigate` + the shared route map. The logo lockup is
 * wrapped in `<GestureLogo>` so home/proto/staff gestures stay reachable.
 */

import { useNavigate } from 'react-router-dom';
import { Lockup } from '../../../components/Logo/Logo';
import { Button } from '../../../components/Button/Button';
import { FindUs } from '../../../components/FindUs/FindUs';
import { GestureLogo } from '../../../app/LogoGestures';
import { useContinuityTheme } from '../../../app/useContinuityTheme';
import { ROUTES } from '../../../app/routes';
import './Welcome.css';

// Hero gradient bottom (forest) → cream Find-us surface.
const HERO_BOTTOM = '#223a2c';
const FINDUS_CREAM = '#f8f3e8';

export function Welcome() {
  const navigate = useNavigate();
  const findUsRef = useContinuityTheme<HTMLDivElement>(HERO_BOTTOM, FINDUS_CREAM);

  return (
    <div className="screen bg-forest">
      <div className="screen-pad center welcome-hero bg-forest">
        <GestureLogo className="welcome-logo">
          <Lockup word="ckyka" sub="specialty coffee shop" />
        </GestureLogo>

        <h1 className="welcome-headline">
          Every coffee counts.
          <br />
          The tenth is ours to give.
        </h1>
        <p className="welcome-lede">
          Collect a cup each visit. No app, no card to carry — it just remembers you.
        </p>

        <div className="stack-sm welcome-actions">
          <Button variant="sage" onClick={() => navigate(ROUTES.register)}>
            Create your card
          </Button>
          <Button
            variant="ghost"
            className="welcome-have-one"
            onClick={() => navigate(ROUTES.lost)}
          >
            I already have one
          </Button>
        </div>

        <div className="welcome-scroll-gap" />
        <div className="welcome-scroll-hint">scroll for hours &amp; location ↓</div>
      </div>

      <FindUs ref={findUsRef} from={HERO_BOTTOM} />
    </div>
  );
}

export default Welcome;
