/**
 * Welcome — unrecognized-visitor landing (UI-SPEC §4.1, UX-SPEC §3).
 *
 * Scrolls. Above the fold: a forest hero (logo lockup, headline, the two entry
 * actions). Below the fold: "Find us" — the café profile from static config,
 * relocated here from the deleted home screen. No data dependency.
 *
 * Navigation only: uses the shared route map + `useNavigate`. App wiring routes
 * `/welcome` here.
 */

import { useNavigate } from 'react-router-dom';
import { Button, Eyebrow } from '../../kit';
import { ROUTES } from '../../app/routes';
import {
  cafeName,
  cafeAddress,
  cafeMapUrl,
  cafeContactEmail,
} from '../../../config/cafe';

/** Static opening-hours copy (no data source; café profile is static config). */
const HOURS: ReadonlyArray<{ days: string; time: string }> = [
  { days: 'Mon – Fri', time: '7:30 – 18:00' },
  { days: 'Saturday', time: '8:30 – 18:00' },
  { days: 'Sunday', time: '9:00 – 16:00' },
];

export function Welcome() {
  const navigate = useNavigate();

  return (
    <main className="screen welcome safe-inset">
      <section className="welcome__hero">
        <div className="welcome__lockup">
          <span className="welcome__mark" aria-hidden="true">
            ☕
          </span>
          <Eyebrow tone="onForest">{cafeName}</Eyebrow>
        </div>
        <h1 className="welcome__headline">Every coffee counts. The tenth is ours to give.</h1>
        <div className="welcome__actions">
          <Button variant="sage" size="lg" block onClick={() => navigate(ROUTES.register)}>
            Create your card
          </Button>
          <Button variant="ghost" size="lg" block onClick={() => navigate(ROUTES.lost)}>
            I already have one
          </Button>
        </div>
      </section>

      <section className="welcome__find" aria-labelledby="find-us-title">
        <Eyebrow>Find us</Eyebrow>
        <h2 id="find-us-title" className="welcome__find-title">
          {cafeName}
        </h2>
        <address className="welcome__address">{cafeAddress}</address>

        <dl className="welcome__hours">
          {HOURS.map((h) => (
            <div className="welcome__hours-row" key={h.days}>
              <dt>{h.days}</dt>
              <dd>{h.time}</dd>
            </div>
          ))}
        </dl>

        <div className="welcome__find-actions">
          <Button as="a" variant="line" href={cafeMapUrl} target="_blank" rel="noreferrer">
            Get directions
          </Button>
          <Button as="a" variant="ghost" href={`mailto:${cafeContactEmail}`}>
            Contact us
          </Button>
        </div>
      </section>
    </main>
  );
}

export default Welcome;
