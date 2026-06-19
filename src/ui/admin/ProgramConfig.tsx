/** ProgramConfig — admin edits the loyalty rules (threshold, reward, caps). */

import { useEffect, useState } from 'react';
import { useServices } from '../common/ServicesContext';
import { useSession } from '../common/SessionContext';
import type { ProgramConfig as Config } from '../../domain/models';

export function ProgramConfig() {
  const { config } = useServices();
  const { actor } = useSession();
  const [form, setForm] = useState<Config | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    config.get().then(setForm);
  }, [config]);

  if (!form) return <p>Loading…</p>;

  function update<K extends keyof Config>(key: K, value: Config[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!actor || !form) return;
    setBusy(true);
    setFlash(null);
    try {
      const saved = await config.update(actor, form);
      setForm(saved);
      setFlash('Program updated.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <h1>Program rules</h1>
      <div className="card">
        <form onSubmit={save}>
          <label>
            Points per reward (threshold)
            <input
              type="number"
              min={1}
              value={form.pointsPerReward}
              onChange={(e) => update('pointsPerReward', Number(e.target.value))}
            />
          </label>
          <label>
            Reward description
            <input
              value={form.rewardDescription}
              onChange={(e) => update('rewardDescription', e.target.value)}
            />
          </label>
          <label>
            Points per purchase (default)
            <input
              type="number"
              min={1}
              value={form.pointsPerPurchase}
              onChange={(e) => update('pointsPerPurchase', Number(e.target.value))}
            />
          </label>
          <label>
            Max points per transaction (cap)
            <input
              type="number"
              min={1}
              value={form.maxPointsPerTransaction}
              onChange={(e) => update('maxPointsPerTransaction', Number(e.target.value))}
            />
          </label>
          <label>
            Card inactivity days (0 = no expiry)
            <input
              type="number"
              min={0}
              value={form.cardInactivityDays}
              onChange={(e) => update('cardInactivityDays', Number(e.target.value))}
            />
          </label>
          {flash && <p className="flash">{flash}</p>}
          <button type="submit" disabled={busy}>
            Save program
          </button>
        </form>
      </div>
    </div>
  );
}
