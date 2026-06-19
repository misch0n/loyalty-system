/** Stats — basic counts only (no segmentation in v1). Also backup export/import. */

import { useEffect, useRef, useState } from 'react';
import { useServices } from '../common/ServicesContext';

export function Stats() {
  const { loyalty, store } = useServices();
  const [stats, setStats] = useState<{
    activeCustomers: number;
    pointsIssued: number;
    rewardsRedeemed: number;
  } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loyalty.getStats().then(setStats);
  }, [loyalty]);

  async function exportData() {
    const snapshot = await store.exportAll();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cafe-loyalty-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importData(file: File) {
    const text = await file.text();
    await store.importAll(JSON.parse(text));
    setFlash('Backup restored.');
    setStats(await loyalty.getStats());
  }

  return (
    <div className="screen">
      <h1>Stats</h1>
      <div className="stat-grid">
        <div className="stat">
          <span className="stat-num">{stats?.activeCustomers ?? '—'}</span>
          <span className="stat-label">Active customers</span>
        </div>
        <div className="stat">
          <span className="stat-num">{stats?.pointsIssued ?? '—'}</span>
          <span className="stat-label">Points issued</span>
        </div>
        <div className="stat">
          <span className="stat-num">{stats?.rewardsRedeemed ?? '—'}</span>
          <span className="stat-label">Rewards redeemed</span>
        </div>
      </div>

      <div className="card">
        <h2>Backup</h2>
        <p className="muted">Prototype JSON export/import (behind the same DataStore port).</p>
        {flash && <p className="flash">{flash}</p>}
        <div className="actions-row">
          <button type="button" onClick={exportData}>
            Export data
          </button>
          <button type="button" className="link" onClick={() => fileRef.current?.click()}>
            Import data
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => e.target.files?.[0] && importData(e.target.files[0])}
          />
        </div>
      </div>
    </div>
  );
}
