/**
 * Suspicious-activity alerts (UI-SPEC §4.10, UX-SPEC §8.1).
 *
 * Renders `loyalty.getAlerts()` as kit AlertRows: trigger = friendly kind +
 * detail, staff = staffName || staffId, device = "—" (the ledger carries no
 * deviceId in v1), time = relative `at`, severity by kind. Monitoring only —
 * nothing here blocks an action; a short explainer makes that explicit.
 */

import { useEffect, useState } from 'react';
import { AlertRow, Banner, Eyebrow } from '../../kit';
import { useServices } from '../../common/ServicesContext';
import type { Alert } from '../../../domain/alerts';
import { alertSeverity, alertTrigger, relativeTime } from './adminFormat';

export function AlertsSection() {
  const services = useServices();
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    services.loyalty
      .getAlerts()
      .then((list) => {
        if (!cancelled) {
          setAlerts(list);
          setError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [services]);

  return (
    <section className="admin-section" aria-labelledby="admin-alerts-h">
      <Eyebrow tone="terra">Watch</Eyebrow>
      <h2 id="admin-alerts-h" className="admin-section__title">
        Suspicious activity
      </h2>
      <p className="admin-section__note">
        These are flags to review, not blocks — every credit still went through. Tune the
        thresholds in the program if a pattern is normal for your café.
      </p>
      {error && <Banner tone="warning">Couldn’t load alerts. Refresh to try again.</Banner>}
      <div className="admin-feed">
        {alerts?.map((alert, i) => (
          <AlertRow
            key={`${alert.kind}-${alert.staffId}-${alert.at}-${i}`}
            trigger={`${alertTrigger(alert.kind)} — ${alert.detail}`}
            staff={alert.staffName ?? alert.staffId}
            device="—"
            time={relativeTime(alert.at)}
            severity={alertSeverity(alert.kind)}
          />
        ))}
        {alerts && alerts.length === 0 && (
          <p className="admin-empty">Nothing to review — no patterns have tripped a flag.</p>
        )}
      </div>
    </section>
  );
}
