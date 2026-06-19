/** AuditLog — filterable view of the append-only action trail. No PII shown. */

import { useEffect, useState } from 'react';
import { useServices } from '../common/ServicesContext';
import type { AuditAction, AuditLogEntry } from '../../domain/models';

const ACTIONS: (AuditAction | 'all')[] = [
  'all',
  'staff.login',
  'staff.login.failed',
  'staff.create',
  'staff.disable',
  'staff.enable',
  'staff.resetPassword',
  'card.issue',
  'card.reissue',
  'customer.register',
  'customer.correct',
  'customer.delete',
  'loyalty.accrue',
  'loyalty.redeem',
  'loyalty.reverse',
  'config.update',
];

export function AuditLog() {
  const { audit } = useServices();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [action, setAction] = useState<AuditAction | 'all'>('all');

  useEffect(() => {
    audit.list(action === 'all' ? { limit: 200 } : { action, limit: 200 }).then(setEntries);
  }, [audit, action]);

  return (
    <div className="screen">
      <h1>Audit log</h1>
      <div className="card">
        <label className="filter">
          Filter by action
          <select value={action} onChange={(e) => setAction(e.target.value as AuditAction | 'all')}>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>

        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.timestamp).toLocaleString()}</td>
                <td>{e.actorRole}</td>
                <td>{e.action}</td>
                <td className="mono small">{e.targetId ? short(e.targetId) : '—'}</td>
                <td>{e.details ?? '—'}</td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No entries.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function short(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}
