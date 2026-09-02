/**
 * StatDetail — the expandable breakdown popover for a headline admin stat
 * (members / coffees / rewards). Opened by tapping a stat tile.
 *
 * A range selector (today · week · month · all time) drives a headline total and
 * a bar chart, derived purely from the audit log via `buildInsight`.
 *
 * Appendix E: this is a SHOP-LEVEL view only. The per-action, staff-attributed
 * entry list that used to sit under the chart is gone — it was an ambient
 * cross-account activity feed reached by a side door. Attributed activity is
 * reachable only through the admin export workflow, which requires a reason and
 * is itself audited.
 */
import { useEffect, useMemo, useState } from 'react';
import { Sheet } from '../../../../components/Sheet/Sheet';
import { useServices } from '../../../../common/ServicesContext';
import type { AuditLogEntry } from '../../../../../domain/models';
import { buildInsight, type MetricKind, type RangeKind } from '../../../../../domain/insights';
import './StatDetail.css';

const TITLES: Record<MetricKind, string> = {
  members: 'New members',
  active: 'Active members',
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
  onClose: () => void;
}

export function StatDetail({ metric, onClose }: StatDetailProps) {
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

        {!insight && <p className="statdetail-empty">Loading…</p>}
      </div>
    </Sheet>
  );
}

export default StatDetail;
