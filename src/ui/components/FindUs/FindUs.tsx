/**
 * FindUs — the below-the-fold "Find us" café profile (hours + location).
 *
 * Shared by the Welcome landing and the recognized-customer card page so both
 * scroll down to the same hours/location continuity. Static café details come
 * from `config/cafe`; no data dependency.
 */
import {
  cafeName,
  cafeAddress,
  cafeMapUrl,
  cafeMapEmbedUrl,
  cafeContactEmail,
  cafeInstagramUrl,
} from '../../../config/cafe';
import './FindUs.css';

/** Static opening-hours copy (no data source; café profile is static config). */
const HOURS: ReadonlyArray<{ days: string; time: string }> = [
  { days: 'Mon – Fri', time: '8:00 – 18:00' },
  { days: 'Sat – Sun', time: '9:00 – 18:00' },
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
      {/* Tapping the map opens it in Maps. The iframe is non-interactive
          (pointer-events disabled in CSS) so the whole tile is one link. */}
      <a
        className="findus-map-link"
        href={cafeMapUrl}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${cafeName} in Maps`}
      >
        <iframe
          className="findus-map"
          title={`Map showing ${cafeName}`}
          src={cafeMapEmbedUrl}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          tabIndex={-1}
        />
      </a>

      <div className="ey findus-contact-title">Contact us</div>
      <div className="findus-links">
        <a className="findus-link" href={`mailto:${cafeContactEmail}`}>
          email
        </a>
        <a
          className="findus-link"
          href={cafeInstagramUrl}
          target="_blank"
          rel="noreferrer"
        >
          instagram
        </a>
      </div>
    </div>
  );
}

export default FindUs;
