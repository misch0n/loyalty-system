/**
 * FindUs — the below-the-fold "Find us" café profile (hours + location).
 *
 * Shared by the Welcome landing and the recognized-customer card page so both
 * scroll down to the same hours/location continuity. Static café details come
 * from `config/cafe`; no data dependency.
 */
import { Button } from '../Button/Button';
import {
  cafeName,
  cafeAddress,
  cafeMapUrl,
  cafeContactEmail,
} from '../../../config/cafe';
import './FindUs.css';

/** Static opening-hours copy (no data source; café profile is static config). */
const HOURS: ReadonlyArray<{ days: string; time: string }> = [
  { days: 'Mon – Fri', time: '7:30 – 18:00' },
  { days: 'Saturday', time: '8:30 – 18:00' },
  { days: 'Sunday', time: '9:00 – 16:00' },
];

export function FindUs() {
  return (
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
  );
}

export default FindUs;
