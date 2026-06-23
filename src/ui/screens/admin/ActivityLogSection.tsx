/**
 * Activity log (UI-SPEC §4.10, UX-SPEC §8).
 *
 * A readable feed from `audit.list({ limit })`, attributed to staff NAMES by
 * resolving each entry's actorId against `staff.list()`. Reads as
 * "Sam · added a coffee · 2m". The audit trail is already PII-free; we only
 * render its neutral fields plus the resolved staff name.
 */

import { useEffect, useState } from 'react';
import { ActivityRow, Banner, Eyebrow } from '../../kit';
import { useServices } from '../../common/ServicesContext';
import type { AuditLogEntry } from '../../../domain/models';
import { auditVerb, relativeTime } from './adminFormat';

const FEED_LIMIT = 60;

export function ActivityLogSection() {
  const services = useServices();
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([services.audit.list({ limit: FEED_LIMIT }), services.staff.list()])
      .then(([log, staff]) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const member of staff) map[member.id] = member.username;
        setNames(map);
        setEntries(log);
        setError(false);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [services]);

  const actorName = (entry: AuditLogEntry): string => {
    if (entry.actorRole === 'system') return 'System';
    return names[entry.actorId] ?? 'Unknown staff';
  };

  return (
    <section className="admin-section" aria-labelledby="admin-activity-h">
      <Eyebrow>Trail</Eyebrow>
      <h2 id="admin-activity-h" className="admin-section__title">
        Activity log
      </h2>
      {error && <Banner tone="warning">Couldn’t load the activity log. Refresh to try again.</Banner>}
      <div className="admin-feed">
        {entries?.map((entry) => (
          <ActivityRow
            key={entry.id}
            actor={actorName(entry)}
            action={auditVerb(entry.action)}
            time={relativeTime(entry.timestamp)}
          />
        ))}
        {entries && entries.length === 0 && (
          <p className="admin-empty">Nothing yet — actions will appear here as staff work.</p>
        )}
      </div>
    </section>
  );
}
