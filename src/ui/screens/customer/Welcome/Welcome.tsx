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
import { GestureLogo } from '../../../app/LogoGestures';
import { ROUTES } from '../../../app/routes';
import {
  cafeName,
  cafeAddress,
  cafeMapUrl,
  cafeContactEmail,
} from '../../../../config/cafe';
import './Welcome.css';

/** Static opening-hours copy (no data source; café profile is static config). */
const HOURS: ReadonlyArray<{ days: string; time: string }> = [
  { days: 'Mon – Fri', time: '7:30 – 18:00' },
  { days: 'Saturday', time: '8:30 – 18:00' },
  { days: 'Sunday', time: '9:00 – 16:00' },
];

export function Welcome() {
  const navigate = useNavigate();

  return (
    <div className="screen bg-forest">
      <div className="screen-pad center welcome-hero">
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

      <div className="findus">
        <div className="ey">Find us</div>
        <h2>{cafeName}</h2>
        <p className="addr">{cafeAddress}</p>
        <div className="hours">
          {HOURS.map((h) => (
            <div className="hr" key={h.days}>
              <span className="d">{h.days}</span>
              <span className="t">{h.time}</span>
            </div>
          ))}
        </div>
        <div className="actions">
          <Button as="a" variant="line" href={cafeMapUrl} target="_blank" rel="noreferrer">
            Get directions
          </Button>
          <Button
            as="a"
            variant="ghost"
            className="findus-contact"
            href={`mailto:${cafeContactEmail}`}
          >
            Contact us
          </Button>
        </div>
      </div>
    </div>
  );
}

export default Welcome;
