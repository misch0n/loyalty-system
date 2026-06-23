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
import { AccountSheet } from '../_parts/AccountSheet/AccountSheet';
import { auditTone, auditVerb, isSameDay, relativeTime } from './format';
import './Admin.css';

interface Stats {
  activeCustomers: number;
  pointsIssued: number;
  rewardsRedeemed: number;
}

const FEED_LIMIT = 60;

const PersonIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <circle cx="12" cy="8" r="3.4" />
    <path d="M5 20c1.2-3.6 4-5 7-5s5.8 1.4 7 5" strokeLinecap="round" />
  </svg>
);
const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
  </svg>
);
const StarIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2l2.4 6.3L21 9l-5 4.2L17.6 20 12 16.4 6.4 20 8 13.2 3 9l6.6-.7z" />
  </svg>
);
const WarnIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M12 4l9 16H3z" strokeLinejoin="round" />
    <path d="M12 10v4" strokeLinecap="round" />
  </svg>
);

function feedIcon(tone: ReturnType<typeof auditTone>) {
  switch (tone) {
    case 'add':
      return <PlusIcon />;
    case 'red':
      return <StarIcon />;
    case 'warn':
      return <WarnIcon />;
    default:
      return <PersonIcon />;
  }
}

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
      services.audit.list({ limit: FEED_LIMIT }),
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

  const confirmEdit = async () => {
    if (!edit) return;
    try {
      if (edit.kind === 'pointsPerReward' || edit.kind === 'maxPointsPerTransaction') {
        if (!config) return;
        const next = window.prompt(
          edit.kind === 'pointsPerReward'
            ? 'Reward earned at how many coffees?'
            : 'Most coffees per scan?',
          String(config[edit.kind]),
        );
        const value = next == null ? NaN : Number(next.trim());
        if (!Number.isFinite(value) || value < 1) {
          setEdit(null);
          toast.show('That number didn’t look right. No change made.');
          return;
        }
        const saved = await services.config.update(actor, { [edit.kind]: value });
        setConfig(saved);
        toast.show('Program updated.');
      } else if (edit.kind === 'revokeAll') {
        const count = await services.staff.revokeAllSessions(actor);
        toast.show(`Signed out all devices (epoch ${count}).`);
      }
    } catch {
      toast.show('Couldn’t make that change. Try again.');
    } finally {
      setEdit(null);
    }
  };

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

  const stepUpCopy = (() => {
    switch (edit?.kind) {
      case 'pointsPerReward':
      case 'maxPointsPerTransaction':
        return {
          title: 'Confirm program change',
          message: 'Re-enter your PIN to update the loyalty program.',
        };
      case 'revokeAll':
        return {
          title: 'Sign out all devices',
          message: 'Re-enter your PIN to revoke every trusted session.',
        };
      default:
        return { title: 'Confirm it’s you', message: 'Re-enter your PIN to make this change.' };
    }
  })();

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
        </div>

        <Eyebrow>Ckyka rewards · admin</Eyebrow>
        <Title style={{ marginBottom: 14 }}>This week</Title>

        <div className="stats">
          <Stat n={stats ? stats.activeCustomers : '—'} label="Active members" delta="all time" />
          <Stat
            n={coffeesToday ?? '—'}
            label="Coffees today"
            delta="credits logged today"
          />
          <Stat
            n={stats ? stats.rewardsRedeemed : '—'}
            label="Rewards redeemed"
            delta="all time"
          />
          <Stat n={flaggedCount} label="Flagged actions" delta="needs a look" />

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

        <SectionH>Needs a look</SectionH>
        {alerts?.map((alert, i) => (
          <Alert
            key={`${alert.kind}-${alert.staffId}-${alert.at}-${i}`}
            title={`${alert.staffName ?? alert.staffId}`}
            detail={alert.detail}
            time={relativeTime(alert.at)}
          />
        ))}
        {alerts && alerts.length === 0 && (
          <p className="admin-empty">Nothing to review — no patterns have tripped a flag.</p>
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
                  {account.username} · {account.role}
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
          {entries?.map((entry) => {
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

        <div className="admin-footer">
          <Button variant="forest" onClick={() => navigate(ROUTES.staff)}>
            Go to counter (scan)
          </Button>
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

      <AccountSheet
        account={manageAccount}
        actor={actor}
        onClose={() => setManageId(null)}
        onChanged={load}
      />

      <StepUp
        open={edit !== null}
        onClose={() => setEdit(null)}
        onConfirm={confirmEdit}
        title={stepUpCopy.title}
        message={stepUpCopy.message}
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
