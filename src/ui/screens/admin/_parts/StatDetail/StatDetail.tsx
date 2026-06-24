/**
 * StatDetail — the expandable breakdown popover for a headline admin stat
 * (members / coffees / rewards). Opened by tapping a stat tile.
 *
 * A range selector (today · week · month · all time) drives a bar chart of
 * activity plus the matching activity entries below, both derived purely from
 * the audit log via `buildInsight`. Reuses the shared Sheet + activity row style.
 */
import { useEffect, useMemo, useState } from 'react';
import { Sheet } from '../../../../components/Sheet/Sheet';
import { useServices } from '../../../../common/ServicesContext';
import type { AuditLogEntry } from '../../../../../domain/models';
import { buildInsight, type MetricKind, type RangeKind } from '../../../../../domain/insights';
import { Feed, FeedRow } from '../FeedRow/FeedRow';
import { feedIcon } from '../feedIcons';
import { auditTone, auditVerb, relativeTime } from '../../Admin/format';
import './StatDetail.css';

const TITLES: Record<MetricKind, string> = {
  members: 'New members',
  coffees: 'Coffees',
  rewards: 'Rewards redeemed',
};

const RANGES: ReadonlyArray<{ key: RangeKind; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'all', label: 'All time' },
];

const RANGE_CAPTION: Record<RangeKind, string> = {
  today: 'today',
  week: 'past 7 days',
  month: 'past 30 days',
  all: 'all time',
};

export interface StatDetailProps {
  /** Which metric to break down, or null when closed. */
  metric: MetricKind | null;
  /** Staff id → display name, for attributing activity rows. */
  names: Record<string, string>;
  onClose: () => void;
}

export function StatDetail({ metric, names, onClose }: StatDetailProps) {
  const services = useServices();
  const [audit, setAudit] = useState<AuditLogEntry[] | null>(null);
  const [range, setRange] = useState<RangeKind>('today');

  // (Re)load the audit log and reset the range each time the popover opens.
  useEffect(() => {
    if (!metric) return;
    setRange('today');
    setAudit(null);
    let active = true;
    void services.audit.list({ limit: 1000 }).then((rows) => {
      if (active) setAudit(rows);
    });
    return () => {
      active = false;
    };
  }, [metric, services]);

  const insight = useMemo(() => {
    if (!metric || !audit) return null;
    return buildInsight(metric, range, audit, Date.now());
  }, [metric, audit, range]);

  const max = Math.max(1, ...(insight?.buckets.map((b) => b.value) ?? [1]));

  const actorName = (entry: AuditLogEntry): string => {
    if (entry.actorRole === 'system') return 'System';
    return names[entry.actorId] ?? 'Staff';
  };

  if (!metric) return null;

  return (
    <Sheet open={metric !== null} onClose={onClose} label={TITLES[metric]}>
      <div className="statdetail">
        <h2 className="statdetail-title">{TITLES[metric]}</h2>

        <div className="statdetail-ranges" role="tablist" aria-label="Range">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              role="tab"
              aria-selected={range === r.key}
              className={`statdetail-range${range === r.key ? ' is-on' : ''}`}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="statdetail-total">
          <span className="statdetail-total-n">{insight ? insight.total : '—'}</span>
          <span className="statdetail-total-c">{RANGE_CAPTION[range]}</span>
        </div>

        <div className="statdetail-chart" aria-hidden="true">
          <div className="statdetail-bars">
            {(insight?.buckets ?? []).map((b, i) => (
              <span className="statdetail-col" key={i} title={`${b.value}`}>
                <span
                  className="statdetail-bar"
                  style={{ height: `${(b.value / max) * 100}%` }}
                />
              </span>
            ))}
          </div>
          <div className="statdetail-axis">
            {(insight?.buckets ?? []).map((b, i) => (
              <span className="statdetail-tick" key={i}>
                {b.label}
              </span>
            ))}
          </div>
        </div>

        <Feed>
          {insight?.entries.map((entry) => {
            const tone = auditTone(entry.action);
            return (
              <FeedRow
                key={entry.id}
                tone={tone}
                icon={feedIcon(tone)}
                text={
                  <>
                    {actorName(entry)} <span>· {auditVerb(entry.action)}</span>
                  </>
                }
                time={relativeTime(entry.timestamp)}
              />
            );
          })}
          {insight && insight.entries.length === 0 && (
            <p className="statdetail-empty">Nothing in this range yet.</p>
          )}
          {!insight && <p className="statdetail-empty">Loading…</p>}
        </Feed>
      </div>
    </Sheet>
  );
}

export default StatDetail;
