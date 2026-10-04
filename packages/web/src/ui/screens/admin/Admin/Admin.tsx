/**
 * Admin — the reference-UI admin screen (Ckyka view 11, UX-SPEC §8).
 *
 * Single scroll: a "Needs a look" alert list, program configuration, account
 * management and "Sign out all devices". No new mutable state — alerts are
 * derived. "Sign out all devices" asks a plain "are you sure?" first
 * (ConfirmSheet, register A7); a program change is confirmed by its own sheet
 * (ProgramEdit). Neither asks for a credential — there is no PIN (S1).
 *
 * Appendix E: there is deliberately NO ambient activity feed here.
 *
 * UI-0 removed the two surfaces the triage dropped: the four "This week" stat
 * tiles with their breakdown popover (SCOPE-DECISIONS §1, FE-A-02/03 — the
 * figures are still collected, they are simply not presented), and the Export
 * activity workflow (BE-A-12 — the server has no cross-account activity
 * endpoint to export from).
 *
 * **Failures (UI-4, X2).** Nothing here toasts a failure. The panel's own load
 * failing shows one sentence and "Try again" in place of the sections it would
 * have filled; a failed confirm, dismiss, save or create is said on the sheet
 * that asked for it, which stays open. Wording comes from `adminFailure.ts`.
 *
 * GUARD: !ready → loading · anon → /login ·
 * signed-in non-admin → "Admins only" notice. Wiring is reused from the old
 * admin sections; only the markup/classes change to the donor.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
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
import type { ProgramConfig, StaffAccount } from '@cafe/shared/domain/models';
import type { Alert as AlertModel } from '@cafe/shared/domain/alerts';
import { StatWide } from '../_parts/Stat/Stat';
import { SectionH } from '../_parts/FeedRow/FeedRow';
import { Alert } from '../_parts/Alert/Alert';
import { ConfirmSheet } from '../_parts/ConfirmSheet/ConfirmSheet';
import { ProgramEdit } from '../_parts/ProgramEdit/ProgramEdit';
import { AccountSheet } from '../_parts/AccountSheet/AccountSheet';
import { AlertDetail } from '../_parts/AlertDetail/AlertDetail';
import { usePager } from '../../../common/usePager';
import { PersonIcon } from '../_parts/feedIcons';
import { alertKey, DEFAULT_THRESHOLDS } from '@cafe/shared/domain/alerts';
import { CONFIG_BOUNDS, type ConfigNumericField } from '@cafe/shared/domain/config';
import { relativeTime } from './format';
import { adminActionMessage, adminFailureMessage } from '../_parts/adminFailure';
import './Admin.css';

const ALERT_PAGE = 4;

/** The numeric settings Configure offers (a subset of the bounded ones). */
type ProgramField = Extract<
  ConfigNumericField,
  | 'pointsPerReward'
  | 'maxPointsPerTransaction'
  | 'selfDealWindowSec'
  | 'selfDealCount'
  | 'repeatWindowMin'
  | 'repeatCount'
>;

/**
 * Numeric program-config fields the Configure panel can edit. Each carries the
 * copy for the `ProgramEdit` value sheet and how the current value reads on
 * the row; the floor and ceiling come from `CONFIG_BOUNDS`, the table the
 * server clamps with (register A4), so a new field needs no bounds of its own.
 *
 * `pointsPerReward` is named for what it does (register A5): it is the number
 * of drinks that earn a free one, and the card's cup grid follows it as
 * `threshold + 1` — those cups plus the pre-stamped free one. There is no
 * separate grid size to set.
 */
const PROGRAM_FIELDS: Record<
  ProgramField,
  { rowLabel: string; title: string; fieldLabel: string; hint?: string; format: (v: number) => string }
> = {
  pointsPerReward: {
    rowLabel: 'Drinks for a free one',
    title: 'Drinks for a free one',
    fieldLabel: 'How many drinks earn a free one?',
    hint: 'Each customer’s card shows this many cups, plus the free one.',
    format: (v: number) => `${v} ${v === 1 ? 'drink' : 'drinks'}`,
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
};

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
  if (status === 'anon' || !actor) {
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

  const [config, setConfig] = useState<ProgramConfig | null>(null);
  const [alerts, setAlerts] = useState<AlertModel[] | null>(null);
  const [staff, setStaff] = useState<StaffAccount[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  // The panel's load: in flight, and what went wrong with the last one (null = ok).
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [edit, setEdit] = useState<EditTarget | null>(null);
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

  // Create-account form (admin defines name, username, password, role).
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newAdmin, setNewAdmin] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Every load takes a number; only the latest one's answer is applied, so an
  // older load that fails late can't put an error over fresher data.
  const loadSeq = useRef(0);
  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    const current = () => seq === loadSeq.current;
    setLoading(true);
    Promise.all([
      services.config.get(),
      services.loyalty.getAlerts(),
      services.staff.list(),
    ]).then(
      ([cfg, alertList, staffList]) => {
        if (!current()) return;
        setConfig(cfg);
        setAlerts(alertList);
        setStaff(staffList);
        const map: Record<string, string> = {};
        for (const member of staffList) map[member.id] = member.name ?? member.username;
        setNames(map);
        setLoadError(null);
        setLoading(false);
      },
      (err: unknown) => {
        if (!current()) return;
        // Whatever loaded before stays on screen; a first load that fails shows
        // the error in place of sections that would only look empty. A reading
        // is not "changes", so the rate-limit copy is a neutral one.
        setLoadError(
          adminFailureMessage(err, 'Couldn’t load the admin panel. Try again.', {
            rate_limited: 'The server is busy just now. Wait a moment, then try again.',
          }),
        );
        setLoading(false);
      },
    );
    return () => {
      // Unmounting (or a re-run of the effect) retires this load.
      if (current()) loadSeq.current += 1;
    };
  }, [services]);

  useEffect(() => load(), [load]);

  const flaggedCount = alerts?.length ?? 0;
  // The sections need all three; until they've loaded once, show none of them.
  const loaded = config !== null && alerts !== null && staff !== null;
  const manageAccount = staff?.find((a) => a.id === manageId) ?? null;

  // "Sign out all devices" — confirmed by ConfirmSheet. The server ends every
  // staff session, this one included, so this device signs out with the rest.
  // A failure is rethrown: ConfirmSheet stays open and says what went wrong.
  const confirmRevokeAll = async () => {
    if (edit?.kind !== 'revokeAll') return;
    await services.staff.revokeAllSessions();
    setEdit(null);
    toast.show('Signed out all devices, including this one.');
    logout();
    navigate(ROUTES.login, { replace: true });
  };

  // Program config save — the value is collected in-app by ProgramEdit (no
  // window.prompt, which mobile Safari suppresses); this just persists it. A
  // failure is rethrown, not toasted: ProgramEdit stays open with the admin's
  // value and says what went wrong on the editor (A4, X2).
  const saveProgram = async (value: number) => {
    if (!edit || edit.kind === 'revokeAll') return;
    const saved = await services.config.update({ [edit.kind]: value });
    setConfig(saved);
    setEdit(null);
    toast.show('Program updated.');
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
    setNewAdmin(false);
    setCreateError(null);
  };

  const submitCreate = async () => {
    if (creating) return;
    if (!newName.trim() || !newUsername.trim() || !newPassword) {
      setCreateError('Name, username and password are all required.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await services.staff.create(
        newUsername.trim(),
        newPassword,
        newAdmin ? 'admin' : 'staff',
        newName.trim(),
      );
      resetCreateForm();
      setCreateOpen(false);
      toast.show(`Account created for ${newName.trim()}.`);
      load();
    } catch (err) {
      // StaffService's refusals are sentences; an ApiError is worded, never shown raw.
      setCreateError(
        adminActionMessage(err, 'Couldn’t create the account. Try again.', {
          rejected: 'Those details weren’t accepted. Use a password of at least 8 characters.',
        }),
      );
    } finally {
      setCreating(false);
    }
  };

  // A failure is rethrown: AlertDetail stays open and says what went wrong.
  const dismissAlert = async (alert: AlertModel) => {
    await services.loyalty.dismissAlert(alertKey(alert));
    setSelectedAlert(null);
    toast.show('Flag acknowledged.');
    load(); // re-derive alerts without the dismissed one
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

        {loadError && (
          <div className="admin-loaderror">
            <p className="admin-loaderror__msg" role="alert">
              {loadError}
            </p>
            <Button variant="line" disabled={loading} onClick={() => load()}>
              {loading ? 'Trying again…' : 'Try again'}
            </Button>
          </div>
        )}
        {!loaded && !loadError && <p className="admin-empty">Loading…</p>}

        {loaded && (
          <>
            {/* Hidden when nothing needs review (no flags, or all acknowledged). */}
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
          </>
        )}
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

      <AlertDetail
        alert={selectedAlert}
        staffName={
          selectedAlert
            ? names[selectedAlert.staffId] ?? selectedAlert.staffName ?? selectedAlert.staffId
            : ''
        }
        onClose={() => setSelectedAlert(null)}
        onDismiss={() => (selectedAlert ? dismissAlert(selectedAlert) : undefined)}
      />

      <AccountSheet
        account={manageAccount}
        actor={actor}
        onClose={() => setManageId(null)}
        onChanged={load}
      />

      {/* Program configuration — more fields will be added here over time. The
          ProgramEdit value sheet opens on top of this one. */}
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

      <ConfirmSheet
        open={edit?.kind === 'revokeAll'}
        onClose={() => setEdit(null)}
        onConfirm={confirmRevokeAll}
        describeError={(err) =>
          adminFailureMessage(err, 'Couldn’t sign out all devices. Try again.')
        }
        title="Sign out all devices?"
        message="Every staff and admin device is signed out, this one included. Each will need its password again."
        confirmLabel="Sign out all"
      />

      <ProgramEdit
        open={programField !== null}
        onClose={() => setEdit(null)}
        title={programEditCopy.title}
        fieldLabel={programEditCopy.fieldLabel}
        hint={programEditCopy.hint}
        min={CONFIG_BOUNDS[programField ?? 'pointsPerReward'].min}
        max={CONFIG_BOUNDS[programField ?? 'pointsPerReward'].max}
        current={
          (programField && fieldValue(programField)) ||
          CONFIG_BOUNDS[programField ?? 'pointsPerReward'].min
        }
        onConfirm={saveProgram}
      />

      <Sheet open={createOpen} onClose={() => setCreateOpen(false)} label="Add a profile">
        <div className="admin-create">
          <Title className="admin-create__title">Add profile</Title>
          <p className="admin-empty">
            The name shows on the staff panel and in the activity log. The username and
            password are for signing in.
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
