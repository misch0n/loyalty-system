/**
 * AlertDetail — the tap-through detail for a "Needs a look" suspicious-activity
 * flag. Shows who triggered it, the kind of warning, the exact time, and the
 * customer card it acted on, plus an acknowledge-and-dismiss action.
 *
 * Monitoring only — dismissing records an acknowledgement (filtered out of
 * future `getAlerts`); it never alters the ledger. No PII is logged.
 */
import { useEffect, useState } from 'react';
import { Button } from '../../../../components/Button/Button';
import { Sheet } from '../../../../components/Sheet/Sheet';
import { useServices } from '../../../../common/ServicesContext';
import type { Customer } from '../../../../../domain/models';
import type { Alert, AlertKind } from '../../../../../domain/alerts';
import './AlertDetail.css';

const KIND_LABEL: Record<AlertKind, string> = {
  velocity: 'Rapid credits',
  'repeat-target': 'Repeated same customer',
  'oversized-multi-add': 'Large single credit',
  'off-hours': 'Outside opening hours',
  'outlier-share': 'Unusual share of credits',
  'earn-then-redeem': 'Earn then redeem',
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

/** Short, PII-free card code from the opaque token (never the whole token). */
function cardCode(token: string): string {
  return `CKY · ${token.slice(-6)}`;
}

export interface AlertDetailProps {
  alert: Alert | null;
  /** Resolved name of the staff member who triggered the flag. */
  staffName: string;
  onClose: () => void;
  onDismiss: () => void | Promise<void>;
}

export function AlertDetail({ alert, staffName, onClose, onDismiss }: AlertDetailProps) {
  const services = useServices();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!alert?.customerId) {
      setCustomer(null);
      return;
    }
    let active = true;
    void services.customers.getById(alert.customerId).then((c) => {
      if (active) setCustomer(c);
    });
    return () => {
      active = false;
    };
  }, [alert, services]);

  if (!alert) return null;

  async function dismiss() {
    if (busy) return;
    setBusy(true);
    try {
      await onDismiss();
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
              {alert.customerId ? (
                customer ? (
                  <>
                    {customer.displayName ?? 'Token-only card'}
                    <span className="alertdetail-code">{cardCode(customer.token)}</span>
                    {customer.status !== 'active' && (
                      <span className="alertdetail-muted"> · {customer.status}</span>
                    )}
                  </>
                ) : (
                  'Loading…'
                )
              ) : (
                'Not tied to one card'
              )}
            </dd>
          </div>
        </dl>

        <Button variant="forest" onClick={() => void dismiss()} disabled={busy}>
          {busy ? 'Acknowledging…' : 'Acknowledge & dismiss'}
        </Button>
      </div>
    </Sheet>
  );
}

export default AlertDetail;
