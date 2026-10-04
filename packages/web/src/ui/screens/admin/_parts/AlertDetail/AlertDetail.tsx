/**
 * AlertDetail — the tap-through detail for a "Needs a look" suspicious-activity
 * flag. Shows who triggered it, the kind of warning, the exact time, and the
 * customer card it acted on, plus an acknowledge-and-dismiss action.
 *
 * Monitoring only — dismissing records an acknowledgement (filtered out of
 * future `getAlerts`); it never alters the ledger. No PII is logged.
 *
 * **Failures stay here (UI-4, X2).** If `onDismiss` rejects, the sheet stays
 * open and says why above the button (`role="alert"`) — never a toast. A card
 * that can't be looked up says so in its own row rather than "Loading…" forever.
 */
import { useEffect, useState } from 'react';
import { Button } from '../../../../components/Button/Button';
import { Sheet } from '../../../../components/Sheet/Sheet';
import { useServices } from '../../../../common/ServicesContext';
import type { Customer } from '@cafe/shared/domain/models';
import type { Alert, AlertKind } from '@cafe/shared/domain/alerts';
import { formatShortCode } from '@cafe/shared/domain/tokens';
import { adminFailureMessage } from '../adminFailure';
import './AlertDetail.css';

const KIND_LABEL: Record<AlertKind, string> = {
  'self-dealing': 'Credited then redeemed',
  'repeat-target': 'Repeated same customer',
};

function exactTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** The flagged card's lookup, as the "Customer card" row shows it. */
type CardLookup =
  | { state: 'loading' }
  | { state: 'found'; customer: Customer }
  | { state: 'missing' }
  | { state: 'failed' };

export const CARD_MISSING = 'This card no longer exists.';
export const CARD_FAILED = 'Couldn’t load this card. Close and reopen to try again.';

export interface AlertDetailProps {
  alert: Alert | null;
  /** Resolved name of the staff member who triggered the flag. */
  staffName: string;
  onClose: () => void;
  /** Acknowledge the flag. Reject to keep the sheet open with the failure. */
  onDismiss: () => void | Promise<void>;
}

export function AlertDetail({ alert, staffName, onClose, onDismiss }: AlertDetailProps) {
  const services = useServices();
  const [card, setCard] = useState<CardLookup>({ state: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setCard({ state: 'loading' });
    if (!alert?.customerId) return;
    let active = true;
    services.customers.getById(alert.customerId).then(
      (c) => {
        if (active) setCard(c ? { state: 'found', customer: c } : { state: 'missing' });
      },
      () => {
        if (active) setCard({ state: 'failed' });
      },
    );
    return () => {
      active = false;
    };
  }, [alert, services]);

  if (!alert) return null;

  async function dismiss() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDismiss();
    } catch (err) {
      setError(adminFailureMessage(err, 'Couldn’t dismiss that flag. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={alert !== null} onClose={onClose} label="Flagged action">
      <div className="alertdetail">
        <span className="alertdetail-tag">⚠️ {KIND_LABEL[alert.kind]}</span>
        <p className="alertdetail-detail">{alert.detail}</p>

        <dl className="alertdetail-rows">
          <div>
            <dt>Staff</dt>
            <dd>{staffName}</dd>
          </div>
          <div>
            <dt>When</dt>
            <dd>{exactTime(alert.at)}</dd>
          </div>
          <div>
            <dt>Customer card</dt>
            <dd>
              {alert.customerId ? <CardRow card={card} /> : 'Not tied to one card'}
            </dd>
          </div>
        </dl>

        {error && (
          <p className="alertdetail-error" role="alert">
            {error}
          </p>
        )}
        <Button variant="forest" onClick={() => void dismiss()} disabled={busy}>
          {busy ? 'Acknowledging…' : 'Acknowledge & dismiss'}
        </Button>
      </div>
    </Sheet>
  );
}

function CardRow({ card }: { card: CardLookup }) {
  switch (card.state) {
    case 'loading':
      return <>Loading…</>;
    case 'missing':
      return <span className="alertdetail-muted">{CARD_MISSING}</span>;
    case 'failed':
      return <span className="alertdetail-muted">{CARD_FAILED}</span>;
    case 'found': {
      const { customer } = card;
      return (
        <>
          {customer.displayName ?? 'Token-only card'}
          <span className="alertdetail-code">CKY · {formatShortCode(customer.shortCode)}</span>
          {customer.status !== 'active' && (
            <span className="alertdetail-muted"> · {customer.status}</span>
          )}
        </>
      );
    }
  }
}

export default AlertDetail;
