/**
 * FindCustomer — recovery + reissue + correction.
 *
 * Search by whatever PII the customer provided. Token-only customers gave no
 * details and so cannot be found here — that tradeoff is disclosed to them at
 * registration. Reissue can rotate the token (default) for safety; corrections
 * are staff-mediated and logged.
 */

import { useState } from 'react';
import { useServices } from '../common/ServicesContext';
import { useSession } from '../common/SessionContext';
import { CustomerStatePanel } from './CustomerStatePanel';
import { CardView } from '../customer/CardView';
import type { Customer } from '../../domain/models';

export function FindCustomer() {
  const { customers } = useServices();
  const { actor } = useSession();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Customer[] | null>(null);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [reissued, setReissued] = useState<Customer | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setSelected(null);
    setReissued(null);
    setFlash(null);
    setResults(await customers.find(term));
  }

  async function reissue(rotate: boolean) {
    if (!actor || !selected) return;
    const updated = await customers.reissue(actor, selected.id, rotate);
    setReissued(updated);
    setSelected(updated);
    setFlash(rotate ? 'Card reissued with a new code.' : 'Card reissued (same code).');
  }

  return (
    <div className="screen">
      <h1>Find a customer</h1>
      <form onSubmit={search} className="search-form">
        <label>
          Name, email or phone
          <input value={term} onChange={(e) => setTerm(e.target.value)} autoComplete="off" />
        </label>
        <button type="submit" disabled={!term.trim()}>
          Search
        </button>
      </form>

      {results && !selected && (
        <div className="card">
          {results.length === 0 ? (
            <p className="muted">
              No active customers match. Token-only customers can't be recovered.
            </p>
          ) : (
            <ul className="result-list">
              {results.map((c) => (
                <li key={c.id}>
                  <button type="button" className="result" onClick={() => setSelected(c)}>
                    <span>{c.displayName || '(no name)'}</span>
                    <span className="muted small">{c.email || c.phone || 'no contact'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {selected && (
        <div className="card">
          <button type="button" className="link" onClick={() => setSelected(null)}>
            ← Back to results
          </button>
          {flash && <p className="flash">{flash}</p>}

          <div className="actions-row">
            <button type="button" onClick={() => reissue(true)}>
              Reissue (new code)
            </button>
            <button type="button" className="link" onClick={() => reissue(false)}>
              Reissue (keep code)
            </button>
            <button type="button" className="link" onClick={() => setCorrecting((v) => !v)}>
              {correcting ? 'Close correction' : 'Correct details'}
            </button>
          </div>

          {correcting && (
            <CorrectForm
              customer={selected}
              onSaved={(updated) => {
                setSelected(updated);
                setCorrecting(false);
                setFlash('Details corrected.');
              }}
            />
          )}

          {reissued && <CardView customer={reissued} />}

          <CustomerStatePanel customerId={selected.id} />
        </div>
      )}
    </div>
  );
}

function CorrectForm({
  customer,
  onSaved,
}: {
  customer: Customer;
  onSaved: (c: Customer) => void;
}) {
  const { customers } = useServices();
  const { actor } = useSession();
  const [displayName, setDisplayName] = useState(customer.displayName ?? '');
  const [email, setEmail] = useState(customer.email ?? '');
  const [phone, setPhone] = useState(customer.phone ?? '');
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!actor) return;
    setBusy(true);
    try {
      const updated = await customers.correct(actor, customer.id, { displayName, email, phone });
      onSaved(updated);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="sub-card" onSubmit={save}>
      <h3>Correct details</h3>
      <label>
        Name
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </label>
      <label>
        Email
        <input value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Phone
        <input value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <button type="submit" disabled={busy}>
        Save corrections
      </button>
    </form>
  );
}
