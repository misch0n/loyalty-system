/**
 * DeleteData — customer-requested erasure, confirmed by staff.
 *
 * Honors the GDPR right to erasure. Soft-deletes (status → deleted, PII cleared)
 * and logs the action. Requires a signed-in staff member to confirm on this
 * device — reflecting that deletion is staff-confirmed.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useServices } from '../common/ServicesContext';
import { useSession } from '../common/SessionContext';
import type { Customer } from '../../domain/models';

export function DeleteData() {
  const { token } = useParams<{ token: string }>();
  const { customers } = useServices();
  const { actor } = useSession();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    customers.getByToken(token).then((c) => {
      if (!c || c.status === 'deleted') setError('No active card found for that code.');
      else setCustomer(c);
    });
  }, [customers, token]);

  async function confirmDelete() {
    if (!customer || !actor) return;
    setBusy(true);
    try {
      await customers.deleteCustomer(actor, customer.id);
      setDone(true);
    } catch {
      setError('Could not delete the data. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="card">
        <h1>Data deleted</h1>
        <p>Your personal details have been removed. Thanks for visiting.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h1>Delete my data</h1>
      {error && <p className="error">{error}</p>}
      {customer && (
        <>
          <p>
            This permanently removes the name, email and phone on this card and
            deactivates it. The café's anonymised transaction records are kept for
            accounting integrity.
          </p>
          {actor ? (
            <button type="button" className="danger" disabled={busy} onClick={confirmDelete}>
              {busy ? 'Deleting…' : 'Staff: confirm deletion'}
            </button>
          ) : (
            <p className="warn">
              A staff member must be signed in on this device to confirm the
              deletion. Please ask at the till.
            </p>
          )}
        </>
      )}
    </div>
  );
}
