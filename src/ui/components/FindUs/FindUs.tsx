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
          loading="eager" /* start loading with the page so a scroll shows it ready */
          referrerPolicy="no-referrer-when-downgrade"
          tabIndex={-1}
        />
      </a>

      <div className="ey findus-contact-title">Contact us</div>
      <div className="findus-links">
        <a
          className="findus-icon"
          href={`mailto:${cafeContactEmail}`}
          aria-label={`Email ${cafeName}`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2.5" />
            <path d="m3.5 7.5 8.5 6 8.5-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
        <a
          className="findus-icon"
          href={cafeInstagramUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`${cafeName} on Instagram`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="5" />
            <circle cx="12" cy="12" r="4" />
            <circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none" />
          </svg>
        </a>
      </div>
    </div>
  );
}

export default FindUs;
