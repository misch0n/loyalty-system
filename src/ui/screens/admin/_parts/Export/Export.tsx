/**
 * Export — the admin investigation workflow (Appendix E).
 *
 * Appendix E removed every ambient, browsable view of cross-account activity.
 * This is the ONLY way to read it, and it is deliberately deliberate: the form
 * opens BLANK (no default range, no preselected accounts, nothing to idly
 * scroll), a written reason is required before Run enables, the result comes
 * back as a downloaded JSON file rather than an on-screen feed, and the export
 * itself is written to the audit log.
 *
 * Past exports are listed below the form — an admin can see who investigated
 * what, and why. Tapping one re-runs its stored filter, which is a NEW audited
 * export, never a silent replay.
 *
 * Admin-only. Not step-up gated, consistent with the other per-profile admin
 * actions (INTEGRITY-PLAN §3.5).
 */
import { useCallback, useEffect, useState } from 'react';
import { Sheet } from '../../../../components/Sheet/Sheet';
import { Field, Toggle } from '../../../../components/Field/Field';
import { Button } from '../../../../components/Button/Button';
import { useToast } from '../../../../components/Toast/Toast';
import { useServices } from '../../../../common/ServicesContext';
import { parseExportRecord, type ExportRecord } from '../../../../../services/AuditService';
import type { Actor } from '../../../../../services/types';
import type { AuditAction, AuditLogEntry, StaffAccount } from '../../../../../domain/models';
import { relativeTime } from '../../Admin/format';
import './Export.css';

/**
 * The action groups an admin can tick. Grouped by what an investigator would
 * actually ask for, rather than exposing the raw action vocabulary.
 */
const ACTION_GROUPS: ReadonlyArray<{ key: string; label: string; actions: AuditAction[] }> = [
  { key: 'counter', label: 'Counter activity', actions: ['loyalty.accrue', 'loyalty.redeem', 'loyalty.reverse'] },
  { key: 'cards', label: 'Cards & members', actions: ['card.issue', 'card.reissue', 'card.provision', 'customer.register', 'customer.recover', 'customer.correct', 'customer.delete'] },
  { key: 'signin', label: 'Sign-ins', actions: ['staff.login', 'staff.login.failed'] },
  { key: 'accounts', label: 'Account changes', actions: ['staff.create', 'staff.disable', 'staff.enable', 'staff.delete', 'staff.resetPassword'] },
  { key: 'program', label: 'Program & exports', actions: ['config.update', 'audit.export'] },
];

export interface ExportProps {
  open: boolean;
  actor: Actor;
  /** Every account — admins included; an investigation must be able to name one. */
  staff: StaffAccount[];
  onClose: () => void;
}

/** `datetime-local` value → ISO, or undefined when blank. */
function toIso(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function accountLabel(account: StaffAccount): string {
  return `${account.name ?? account.username} · ${account.role}`;
}

export function Export({ open, actor, staff, onClose }: ExportProps) {
  const services = useServices();
  const toast = useToast();

  // Blank by default — nothing is preselected, on purpose.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [groups, setGroups] = useState<Record<string, boolean>>({});
  const [accounts, setAccounts] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [past, setPast] = useState<AuditLogEntry[] | null>(null);

  const loadPast = useCallback(() => {
    void services.audit
      .list({ action: 'audit.export', limit: 20 })
      .then(setPast)
      .catch(() => setPast([]));
  }, [services]);

  useEffect(() => {
    if (!open) return;
    setFrom('');
    setTo('');
    setGroups({});
    setAccounts({});
    setReason('');
    loadPast();
  }, [open, loadPast]);

  if (!open) return null;

  const chosenActions = ACTION_GROUPS.filter((g) => groups[g.key]).flatMap((g) => g.actions);
  const chosenAccounts = staff.filter((a) => accounts[a.id]).map((a) => a.id);
  const canRun = reason.trim().length > 0 && !busy;

  /** Run the export: audited server-side, downloaded as a JSON file. */
  const run = async (filter: {
    from?: string;
    to?: string;
    actions?: AuditAction[];
    actorIds?: string[];
  }, why: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const rows = await services.audit.exportActivity(actor, filter, why);
      download(rows, filter, why);
      toast.show(`Exported ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}.`);
      loadPast(); // the export we just ran is itself now in the list
    } catch {
      toast.show('Couldn’t run that export. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const onRun = () =>
    void run(
      {
        from: toIso(from),
        to: toIso(to),
        actions: chosenActions.length > 0 ? chosenActions : undefined,
        actorIds: chosenAccounts.length > 0 ? chosenAccounts : undefined,
      },
      reason,
    );

  /** Re-run a past export's stored filter — a NEW audited export, not a replay. */
  const onRerun = (record: ExportRecord) =>
    void run(
      {
        from: record.from,
        to: record.to,
        actions: record.actions,
        actorIds: record.actorIds,
      },
      `Re-run: ${record.reason}`,
    );

  return (
    <Sheet open={open} onClose={onClose} label="Export activity">
      <div className="export">
        <h2 className="export__title">Export activity</h2>
        <p className="export__lead">
          Activity isn’t browsable — pull the specific slice you need. Every export is
          recorded with your reason, and admins are included like anyone else.
        </p>

        <div className="export__group">Time range</div>
        <div className="export__range">
          <Field
            label="From"
            type="datetime-local"
            value={from}
            onChange={setFrom}
            optional
          />
          <Field label="To" type="datetime-local" value={to} onChange={setTo} optional />
        </div>

        <div className="export__group">Action types</div>
        <div className="export__checks">
          {ACTION_GROUPS.map((group) => (
            <Toggle
              key={group.key}
              label={group.label}
              on={!!groups[group.key]}
              onChange={(v) => setGroups((prev) => ({ ...prev, [group.key]: v }))}
            />
          ))}
        </div>

        <div className="export__group">Accounts</div>
        <div className="export__checks">
          {staff.map((account) => (
            <Toggle
              key={account.id}
              label={accountLabel(account)}
              on={!!accounts[account.id]}
              onChange={(v) => setAccounts((prev) => ({ ...prev, [account.id]: v }))}
            />
          ))}
        </div>
        <p className="export__note">
          Leave a section untouched to include everything in it.
        </p>

        <div className="export__group">Reason</div>
        <Field
          label="Why are you pulling this?"
          value={reason}
          onChange={setReason}
          placeholder="e.g. checking a disputed reward"
          hint="Recorded on the audit trail. Don’t put customer names or contact details here."
        />

        <Button
          variant="forest"
          className="export__run"
          onClick={onRun}
          disabled={!canRun}
        >
          {busy ? 'Exporting…' : 'Run export'}
        </Button>

        <div className="export__group">Past exports</div>
        {past == null ? (
          <p className="export__empty">Loading…</p>
        ) : past.length === 0 ? (
          <p className="export__empty">No exports yet.</p>
        ) : (
          <ul className="export__past">
            {past.map((entry) => {
              const record = parseExportRecord(entry.details);
              if (!record) return null;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="export__past-row"
                    onClick={() => onRerun(record)}
                    disabled={busy}
                  >
                    <span className="export__past-reason">{record.reason}</span>
                    <span className="export__past-meta">
                      {record.count} {record.count === 1 ? 'entry' : 'entries'} ·{' '}
                      {relativeTime(entry.timestamp)} · tap to re-run
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

/** Serialize the result to a JSON file and hand it to the browser. */
function download(
  rows: AuditLogEntry[],
  filter: { from?: string; to?: string; actions?: AuditAction[]; actorIds?: string[] },
  reason: string,
): void {
  const payload = {
    exportedAt: new Date().toISOString(),
    reason,
    filter,
    count: rows.length,
    entries: rows,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `activity-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default Export;
