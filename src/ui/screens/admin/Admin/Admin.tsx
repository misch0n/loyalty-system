/**
 * Admin — the reference-UI admin screen (Ckyka view 11, UX-SPEC §8).
 *
 * Single scroll: derived "This week" stats + editable program rows, a
 * "Needs a look" alert list, staff management, "Sign out all devices", and the
 * full activity log attributed to staff NAMES. All figures are DERIVED from the
 * ledger/audit trail — no new mutable state. Destructive/program changes go
 * through step-up PIN re-auth (StepUp → useAuth().unlock → service mutation).
 *
 * GUARD: !ready → loading · locked → /staff/unlock · anon → /login ·
 * signed-in non-admin → "Admins only" notice. Wiring is reused from the old
 * admin sections; only the markup/classes change to the donor.
 *
 * BACKEND GAP: there is no "coffees today" service read. We approximate it by
 * counting today's `loyalty.accrue` audit rows — this counts accrual EVENTS,
 * not points added (a multi-add of 2 counts once). Honest label in the delta.
 */
import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Eyebrow, Title } from '../../../components/Heading/Heading';
import { Button } from '../../../components/Button/Button';
import { LogoMark } from '../../../components/Logo/Logo';
import { Field, Toggle } from '../../../components/Field/Field';
import { Sheet } from '../../../components/Sheet/Sheet';
import { useToast } from '../../../components/Toast/Toast';
import { GestureLogo } from '../../../app/LogoGestures';
import { useAuth } from '../../../app/AuthContext';
import { ROUTES } from '../../../app/routes';
import { useServices } from '../../../common/ServicesContext';
import type { Actor } from '../../../../services/types';
import type { AuditLogEntry, ProgramConfig, StaffAccount } from '../../../../domain/models';
import type { Alert as AlertModel } from '../../../../domain/alerts';
import { Stat, StatWide } from '../_parts/Stat/Stat';
import { Feed, FeedRow, SectionH } from '../_parts/FeedRow/FeedRow';
import { Alert } from '../_parts/Alert/Alert';
import { StepUp } from '../_parts/StepUp/StepUp';
import { ProgramEdit } from '../_parts/ProgramEdit/ProgramEdit';
import { AccountSheet } from '../_parts/AccountSheet/AccountSheet';
import { StatDetail } from '../_parts/StatDetail/StatDetail';
import { AlertDetail } from '../_parts/AlertDetail/AlertDetail';
import { usePager } from '../_parts/usePager';
import { PersonIcon, feedIcon } from '../_parts/feedIcons';
import type { MetricKind } from '../../../../domain/insights';
import { alertKey } from '../../../../domain/alerts';
import { auditTone, auditVerb, isSameDay, relativeTime } from './format';
import './Admin.css';

interface Stats {
  activeCustomers: number;
  pointsIssued: number;
  rewardsRedeemed: number;
}

const ACTIVITY_PAGE = 8;
const ALERT_PAGE = 4;

type EditTarget =
  | { kind: 'pointsPerReward' }
  | { kind: 'maxPointsPerTransaction' }
  | { kind: 'revokeAll' };

export function Admin() {
  const { actor, status, ready } = useAuth();

  if (!ready) {
    return (
      <div className="screen admin bg-cream" aria-busy="true">
        <div className="screen-pad">
          <p className="admin-empty">Loading…</p>
        </div>
      </div>
    );
  }
  if (status === 'locked') {
    return <Navigate to={ROUTES.staffUnlock} replace />;
  }
  if (!actor) {
    return <Navigate to={ROUTES.login} replace />;
  }
  if (actor.role !== 'admin') {
    return (
      <div className="screen admin bg-cream">
        <div className="screen-pad">
          <div className="admin-head">
            <GestureLogo>
              <LogoMark size="sm" />
            </GestureLogo>
          </div>
          <Eyebrow>Restricted</Eyebrow>
          <Title>Admins only</Title>
          <p className="admin-empty">
            You’re signed in as {actor.name ?? actor.username}, but this area needs an admin
            account. Ask an admin to sign in here.
          </p>
        </div>
      </div>
    );
  }

  return <AdminScreen actor={actor} />;
}

function AdminScreen({ actor }: { actor: Actor }) {
  const services = useServices();
  const toast = useToast();
  const navigate = useNavigate();
  const { logout } = useAuth();

  const [stats, setStats] = useState<Stats | null>(null);
  const [coffeesToday, setCoffeesToday] = useState<number | null>(null);
  const [config, setConfig] = useState<ProgramConfig | null>(null);
  const [alerts, setAlerts] = useState<AlertModel[] | null>(null);
  const [staff, setStaff] = useState<StaffAccount[] | null>(null);
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  const [edit, setEdit] = useState<EditTarget | null>(null);
  // Which headline stat's breakdown popover is open (null = closed).
  const [detailMetric, setDetailMetric] = useState<MetricKind | null>(null);
  // "Needs a look" is collapsed by default; the flagged alert in detail view.
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<AlertModel | null>(null);

  const activityPager = usePager(entries?.length ?? 0, ACTIVITY_PAGE);
  const alertPager = usePager(alerts?.length ?? 0, ALERT_PAGE);
  // The id of the profile whose management popover is open (null = closed). We
  // derive the live account from `staff` so edits (disable, delete…) reflect
  // immediately and a deleted account closes the sheet.
  const [manageId, setManageId] = useState<string | null>(null);

  // Create-account form (admin defines name, username, password, PIN, role).
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newAdmin, setNewAdmin] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    void Promise.all([
      services.loyalty.getStats(),
      services.audit.list({ action: 'loyalty.accrue', limit: 500 }),
      services.config.get(),
      services.loyalty.getAlerts(),
      services.staff.list(),
      services.audit.list({}), // all entries; the Activity feed pages client-side
    ]).then(([s, accruals, cfg, alertList, staffList, log]) => {
      if (cancelled) return;
      setStats(s);
      setCoffeesToday(accruals.filter((a) => isSameDay(a.timestamp)).length);
      setConfig(cfg);
      setAlerts(alertList);
      setStaff(staffList);
      const map: Record<string, string> = {};
      for (const member of staffList) map[member.id] = member.name ?? member.username;
      setNames(map);
      setEntries(log);
    });
    return () => {
      cancelled = true;
    };
  }, [services]);

  useEffect(() => load(), [load]);

  const flaggedCount = alerts?.length ?? 0;
  const manageAccount = staff?.find((a) => a.id === manageId) ?? null;

  // "Sign out all devices" — PIN-gated via StepUp (PIN only, no value).
  const confirmRevokeAll = async () => {
    if (edit?.kind !== 'revokeAll') return;
    try {
      const count = await services.staff.revokeAllSessions(actor);
      toast.show(`Signed out all devices (epoch ${count}).`);
    } catch {
      toast.show('Couldn’t make that change. Try again.');
    } finally {
      setEdit(null);
    }
  };

  // Program config save — value + PIN are collected in-app by ProgramEdit (no
  // more window.prompt, which mobile Safari suppressed); this just persists it.
  const saveProgram = async (value: number) => {
    if (edit?.kind !== 'pointsPerReward' && edit?.kind !== 'maxPointsPerTransaction') return;
    try {
      const saved = await services.config.update(actor, { [edit.kind]: value });
      setConfig(saved);
      toast.show('Program updated.');
    } catch {
      toast.show('Couldn’t make that change. Try again.');
    } finally {
      setEdit(null);
    }
  };

  const isProgramEdit =
    edit?.kind === 'pointsPerReward' || edit?.kind === 'maxPointsPerTransaction';
  const programEditCopy =
    edit?.kind === 'pointsPerReward'
      ? { title: 'Reward threshold', fieldLabel: 'Reward earned at how many coffees?' }
      : { title: 'Max coffees per scan', fieldLabel: 'Most coffees per scan?' };

  const resetCreateForm = () => {
    setNewName('');
    setNewUsername('');
    setNewPassword('');
    setNewPin('');
    setNewAdmin(false);
    setCreateError(null);
  };

  const submitCreate = async () => {
    if (creating) return;
    if (!newName.trim() || !newUsername.trim() || !newPassword) {
      setCreateError('Name, username and password are all required.');
      return;
    }
    if (newPin && !/^\d{4,8}$/.test(newPin.trim())) {
      setCreateError('A PIN must be 4–8 digits (or leave it blank).');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await services.staff.create(
        actor,
        newUsername.trim(),
        newPassword,
        newAdmin ? 'admin' : 'staff',
        newPin.trim() || undefined,
        newName.trim(),
      );
      resetCreateForm();
      setCreateOpen(false);
      toast.show(`Account created for ${newName.trim()}.`);
      load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create the account.');
    } finally {
      setCreating(false);
    }
  };

  const dismissAlert = async (alert: AlertModel) => {
    try {
      await services.loyalty.dismissAlert(actor, alertKey(alert));
      toast.show('Flag acknowledged.');
    } catch {
      toast.show('Couldn’t dismiss that. Try again.');
    } finally {
      setSelectedAlert(null);
      load(); // re-derive alerts without the dismissed one
    }
  };

  const actorName = (entry: AuditLogEntry): string => {
    if (entry.actorRole === 'system') return 'System';
    return names[entry.actorId] ?? 'Unknown staff';
  };

  return (
    <div className="screen admin bg-cream">
      <div className="screen-pad">
        <div className="admin-head">
          <GestureLogo>
            <LogoMark size="sm" />
          </GestureLogo>
          <Button
            variant="forest"
            className="admin-tocounter"
            onClick={() => navigate(ROUTES.staff)}
          >
            Go to counter
          </Button>
        </div>

        <Eyebrow>Ckyka rewards · admin</Eyebrow>
        <Title style={{ marginBottom: 14 }}>This week</Title>

        <div className="stats">
          <Stat
            n={stats ? stats.activeCustomers : '—'}
            label="Active members"
            delta="tap for trend"
            onClick={() => setDetailMetric('members')}
          />
          <Stat
            n={coffeesToday ?? '—'}
            label="Coffees today"
            delta="tap for trend"
            onClick={() => setDetailMetric('coffees')}
          />
          <Stat
            n={stats ? stats.rewardsRedeemed : '—'}
            label="Rewards redeemed"
            delta="tap for trend"
            onClick={() => setDetailMetric('rewards')}
          />

          <StatWide
            setLabel="Reward earned at"
            setVal={config ? `${config.pointsPerReward} coffees` : '—'}
            onEdit={() => setEdit({ kind: 'pointsPerReward' })}
          />
          <StatWide
            setLabel="Max coffees per scan"
            setVal={config ? String(config.maxPointsPerTransaction) : '—'}
            onEdit={() => setEdit({ kind: 'maxPointsPerTransaction' })}
          />
        </div>

        <button
          type="button"
          className="admin-collapse"
          aria-expanded={alertsOpen}
          onClick={() => setAlertsOpen((o) => !o)}
        >
          <span className="section-h">Needs a look</span>
          {flaggedCount > 0 && <span className="admin-badge">{flaggedCount}</span>}
          <span className="admin-collapse-chev" aria-hidden="true">
            {alertsOpen ? '⌄' : '›'}
          </span>
        </button>
        {alertsOpen && (
          <>
            {alerts?.slice(0, alertPager.count).map((alert, i) => (
              <Alert
                key={`${alert.kind}-${alert.staffId}-${alert.at}-${i}`}
                title={names[alert.staffId] ?? alert.staffName ?? alert.staffId}
                detail={alert.detail}
                time={relativeTime(alert.at)}
                onClick={() => setSelectedAlert(alert)}
              />
            ))}
            {alerts && alerts.length === 0 && (
              <p className="admin-empty">Nothing to review — no patterns have tripped a flag.</p>
            )}
            {alertPager.canMore && (
              <div className="admin-more">
                <button type="button" className="admin-more-btn" onClick={alertPager.more}>
                  Load more
                </button>
                {alertPager.showLoadAll && (
                  <button type="button" className="admin-more-all" onClick={alertPager.loadAll}>
                    Load all {alerts?.length}
                  </button>
                )}
              </div>
            )}
          </>
        )}

        <SectionH>Accounts</SectionH>
        <div className="acct-list">
          {staff?.map((account) => (
            <button
              key={account.id}
              type="button"
              className="acct-list-row"
              onClick={() => setManageId(account.id)}
            >
              <span className="ali">
                <PersonIcon />
              </span>
              <span className="alt">
                <span className="aln">
                  {account.name ?? account.username}
                  {!account.active && <em> · disabled</em>}
                </span>
                <span className="alm">
                  {account.username} · <span className="role">{account.role}</span>
                </span>
              </span>
              <span className="alc" aria-hidden="true">
                ›
              </span>
            </button>
          ))}
          {staff && staff.length === 0 && <p className="admin-empty">No accounts yet.</p>}
        </div>
        <Button
          variant="forest"
          style={{ marginTop: 12 }}
          onClick={() => {
            resetCreateForm();
            setCreateOpen(true);
          }}
        >
          Add profile
        </Button>
        <Button
          variant="line"
          style={{ marginTop: 10 }}
          onClick={() => setEdit({ kind: 'revokeAll' })}
        >
          Sign out all devices
        </Button>

        <SectionH>Activity</SectionH>
        <Feed>
          {entries?.slice(0, activityPager.count).map((entry) => {
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
          {entries && entries.length === 0 && (
            <p className="admin-empty">Nothing yet — actions will appear here as staff work.</p>
          )}
        </Feed>
        {activityPager.canMore && (
          <div className="admin-more">
            <button type="button" className="admin-more-btn" onClick={activityPager.more}>
              Load more
            </button>
            {activityPager.showLoadAll && (
              <button type="button" className="admin-more-all" onClick={activityPager.loadAll}>
                Load all {entries?.length}
              </button>
            )}
          </div>
        )}

        <div className="admin-footer">
          <Button
            variant="ghost"
            className="admin-signout"
            onClick={() => {
              logout();
              navigate(ROUTES.login, { replace: true });
            }}
          >
            Sign out
          </Button>
        </div>
      </div>

      <StatDetail
        metric={detailMetric}
        names={names}
        onClose={() => setDetailMetric(null)}
      />

      <AlertDetail
        alert={selectedAlert}
        staffName={
          selectedAlert
            ? names[selectedAlert.staffId] ?? selectedAlert.staffName ?? selectedAlert.staffId
            : ''
        }
        onClose={() => setSelectedAlert(null)}
        onDismiss={() => {
          if (selectedAlert) void dismissAlert(selectedAlert);
        }}
      />

      <AccountSheet
        account={manageAccount}
        actor={actor}
        onClose={() => setManageId(null)}
        onChanged={load}
      />

      <StepUp
        open={edit?.kind === 'revokeAll'}
        onClose={() => setEdit(null)}
        onConfirm={confirmRevokeAll}
        title="Sign out all devices"
        message="Re-enter your PIN to revoke every trusted session."
      />

      <ProgramEdit
        open={isProgramEdit}
        onClose={() => setEdit(null)}
        title={programEditCopy.title}
        fieldLabel={programEditCopy.fieldLabel}
        current={config && isProgramEdit ? config[(edit as { kind: 'pointsPerReward' | 'maxPointsPerTransaction' }).kind] : 1}
        onConfirm={saveProgram}
      />

      <Sheet open={createOpen} onClose={() => setCreateOpen(false)} label="Add a profile">
        <div className="admin-create">
          <Title className="admin-create__title">Add profile</Title>
          <p className="admin-empty">
            The name shows on the staff panel and in the activity log. The username and
            password are for signing in; the PIN is the quick re-auth on a remembered device.
          </p>
          <Field
            label="Name"
            type="text"
            placeholder="Maria"
            value={newName}
            onChange={(v) => {
              setCreateError(null);
              setNewName(v);
            }}
            disabled={creating}
          />
          <Field
            label="Username"
            type="text"
            autoComplete="off"
            placeholder="maria"
            value={newUsername}
            onChange={(v) => {
              setCreateError(null);
              setNewUsername(v);
            }}
            disabled={creating}
          />
          <Field
            label="Password"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={newPassword}
            onChange={(v) => {
              setCreateError(null);
              setNewPassword(v);
            }}
            disabled={creating}
          />
          <Field
            label="PIN"
            optional
            type="text"
            inputMode="numeric"
            placeholder="4–8 digits"
            value={newPin}
            onChange={(v) => {
              setCreateError(null);
              setNewPin(v.replace(/\D/g, ''));
            }}
            disabled={creating}
          />
          <div className="admin-create__role">
            <Toggle on={newAdmin} onChange={setNewAdmin} label="Admin account" />
          </div>
          {createError && (
            <p className="admin-create__error" role="alert">
              {createError}
            </p>
          )}
          <Button
            variant="forest"
            disabled={creating}
            onClick={() => void submitCreate()}
          >
            {creating ? 'Creating…' : 'Create account'}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
