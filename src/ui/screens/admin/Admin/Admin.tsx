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
import type { ProgramConfig, StaffAccount } from '../../../../domain/models';
import type { Alert as AlertModel } from '../../../../domain/alerts';
import { Stat, StatWide } from '../_parts/Stat/Stat';
import { SectionH } from '../_parts/FeedRow/FeedRow';
import { Alert } from '../_parts/Alert/Alert';
import { StepUp } from '../_parts/StepUp/StepUp';
import { ProgramEdit } from '../_parts/ProgramEdit/ProgramEdit';
import { AccountSheet } from '../_parts/AccountSheet/AccountSheet';
import { StatDetail } from '../_parts/StatDetail/StatDetail';
import { AlertDetail } from '../_parts/AlertDetail/AlertDetail';
import { usePager } from '../../../common/usePager';
import { PersonIcon } from '../_parts/feedIcons';
import type { MetricKind } from '../../../../domain/insights';
import { alertKey, DEFAULT_THRESHOLDS } from '../../../../domain/alerts';
import { isSameDay, relativeTime } from './format';
import './Admin.css';

interface Stats {
  activeCustomers: number;
  pointsIssued: number;
  rewardsRedeemed: number;
}

const ALERT_PAGE = 4;

/**
 * Numeric program-config fields the Configure panel can edit. Each carries the
 * copy for the value+PIN `ProgramEdit` sheet and how the current value reads on
 * the row. Add a field here and it appears in Configure — nothing else to wire.
 */
const PROGRAM_FIELDS = {
  pointsPerReward: {
    rowLabel: 'Reward earned at',
    title: 'Reward threshold',
    fieldLabel: 'Reward earned at how many coffees?',
    format: (v: number) => `${v} coffees`,
  },
  maxPointsPerTransaction: {
    rowLabel: 'Max coffees per scan',
    title: 'Max coffees per scan',
    fieldLabel: 'Most coffees per scan?',
    format: (v: number) => String(v),
  },
  selfDealWindowSec: {
    rowLabel: 'Self-dealing window',
    title: 'Self-dealing window',
    fieldLabel: 'Redeem within how many seconds of a credit?',
    format: (v: number) => `${v}s`,
  },
  selfDealCount: {
    rowLabel: 'Self-dealing flags at',
    title: 'Self-dealing count',
    fieldLabel: 'Flag after how many close credit-then-redeem pairs?',
    format: (v: number) => `${v} times`,
  },
  repeatWindowMin: {
    rowLabel: 'Repeat-target window',
    title: 'Repeat-target window',
    fieldLabel: 'Same card credited within how many minutes?',
    format: (v: number) => `${v} min`,
  },
  repeatCount: {
    rowLabel: 'Repeat-target flags above',
    title: 'Repeat-target count',
    fieldLabel: 'Flag above how many credits to the same card?',
    format: (v: number) => `${v} times`,
  },
} as const;

type ProgramField = keyof typeof PROGRAM_FIELDS;

const ALERT_FIELDS: ProgramField[] = [
  'selfDealWindowSec',
  'selfDealCount',
  'repeatWindowMin',
  'repeatCount',
];

type EditTarget = { kind: ProgramField } | { kind: 'revokeAll' };

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
  const [activeToday, setActiveToday] = useState<number | null>(null);
  const [config, setConfig] = useState<ProgramConfig | null>(null);
  const [alerts, setAlerts] = useState<AlertModel[] | null>(null);
  const [staff, setStaff] = useState<StaffAccount[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  const [edit, setEdit] = useState<EditTarget | null>(null);
  // Which headline stat's breakdown popover is open (null = closed).
  const [detailMetric, setDetailMetric] = useState<MetricKind | null>(null);
  // "Needs a look" is collapsed by default; the flagged alert in detail view.
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<AlertModel | null>(null);
  // Program-config popover (reward threshold, max coffees per scan, …).
  const [configureOpen, setConfigureOpen] = useState(false);

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
      services.audit.list({}), // aggregate only — used for the 'active today' count
    ]).then(([s, accruals, cfg, alertList, staffList, log]) => {
      if (cancelled) return;
      setStats(s);
      setCoffeesToday(accruals.filter((a) => isSameDay(a.timestamp)).length);
      // Active members today = unique customer cards used (any loyalty activity).
      const activeIds = new Set(
        log
          .filter(
            (e) =>
              (e.action === 'loyalty.accrue' || e.action === 'loyalty.redeem') &&
              isSameDay(e.timestamp) &&
              e.targetId,
          )
          .map((e) => e.targetId as string),
      );
      setActiveToday(activeIds.size);
      setConfig(cfg);
      setAlerts(alertList);
      setStaff(staffList);
      const map: Record<string, string> = {};
      for (const member of staffList) map[member.id] = member.name ?? member.username;
      setNames(map);
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
    if (!edit || edit.kind === 'revokeAll') return;
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

  const programField: ProgramField | null =
    edit && edit.kind !== 'revokeAll' ? edit.kind : null;
  const programEditCopy = programField
    ? PROGRAM_FIELDS[programField]
    : PROGRAM_FIELDS.pointsPerReward;

  /** Current value of a config field, falling back to the detector defaults. */
  const fieldValue = (field: ProgramField): number | undefined =>
    config ? (config[field] ?? DEFAULT_THRESHOLDS[field as keyof typeof DEFAULT_THRESHOLDS]) : undefined;

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

  return (
    <div className="screen admin bg-cream">
      <div className="screen-pad">
        <div className="admin-head">
          <div className="admin-head-left">
            <GestureLogo>
              <LogoMark size="sm" />
            </GestureLogo>
            <span className="admin-role">Admin</span>
          </div>
          <Button
            variant="forest"
            className="admin-tocounter"
            onClick={() => navigate(ROUTES.staff)}
          >
            Go to counter
          </Button>
        </div>

        <Eyebrow>Ckyka rewards · admin</Eyebrow>

        {/* Surfaced above the week's stats; hidden when nothing needs review
            (no flags, or all acknowledged). */}
        {flaggedCount > 0 && (
          <>
            <button
              type="button"
              className="admin-collapse"
              aria-expanded={alertsOpen}
              onClick={() => setAlertsOpen((o) => !o)}
            >
              <span className="section-h">Needs a look</span>
              <span className="admin-badge">{flaggedCount}</span>
              <svg
                className={`admin-chev${alertsOpen ? ' is-open' : ''}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
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
          </>
        )}

        <Title style={{ marginBottom: 14 }}>This week</Title>

        <div className="stats">
          <Stat
            n={stats ? stats.activeCustomers : '—'}
            label="New members"
            delta="tap for trend"
            onClick={() => setDetailMetric('members')}
          />
          <Stat
            n={activeToday ?? '—'}
            label="Active members"
            delta="tap for trend"
            onClick={() => setDetailMetric('active')}
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
        </div>

        <Button variant="line" style={{ marginTop: 12 }} onClick={() => setConfigureOpen(true)}>
          Configure program
        </Button>

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

      <StatDetail metric={detailMetric} onClose={() => setDetailMetric(null)} />

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

      {/* Program configuration — more fields will be added here over time. The
          ProgramEdit (value + PIN) sheet opens on top of this one. */}
      <Sheet open={configureOpen} onClose={() => setConfigureOpen(false)} label="Configure program">
        <div className="admin-configure">
          <Title className="admin-create__title">Configure program</Title>
          <div className="stats">
            {(['pointsPerReward', 'maxPointsPerTransaction'] as ProgramField[]).map((field) => {
              const value = fieldValue(field);
              return (
                <StatWide
                  key={field}
                  setLabel={PROGRAM_FIELDS[field].rowLabel}
                  setVal={value === undefined ? '—' : PROGRAM_FIELDS[field].format(value)}
                  onEdit={() => setEdit({ kind: field })}
                />
              );
            })}
          </div>

          {/* Detector thresholds (Appendix E). Alerts surface, never block —
              tuning these changes what an admin is shown, not what staff may do. */}
          <p className="admin-configure__group">Activity alerts</p>
          <p className="admin-empty">
            Two checks run on counter activity: a card credited then redeemed by the same
            person within moments, repeatedly; and the same card credited over and over in a
            short window. Both only flag for review — neither ever blocks a sale.
          </p>
          <div className="stats">
            {ALERT_FIELDS.map((field) => {
              const value = fieldValue(field);
              return (
                <StatWide
                  key={field}
                  setLabel={PROGRAM_FIELDS[field].rowLabel}
                  setVal={value === undefined ? '—' : PROGRAM_FIELDS[field].format(value)}
                  onEdit={() => setEdit({ kind: field })}
                />
              );
            })}
          </div>
        </div>
      </Sheet>

      <StepUp
        open={edit?.kind === 'revokeAll'}
        onClose={() => setEdit(null)}
        onConfirm={confirmRevokeAll}
        title="Sign out all devices"
        message="Re-enter your PIN to revoke every trusted session."
      />

      <ProgramEdit
        open={programField !== null}
        onClose={() => setEdit(null)}
        title={programEditCopy.title}
        fieldLabel={programEditCopy.fieldLabel}
        current={(programField && fieldValue(programField)) || 1}
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
