/**
 * PrototypeMenu — collapses the demo-only scaffolding behind the "prototype"
 * label in the header. Holds device pairing, a sign-in shortcut, and a Reset
 * that wipes this device's local data so a workflow can be run from scratch.
 * None of this exists in production.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useServices } from './ServicesContext';
import { usePairing } from './PairingContext';
import { useSession } from './SessionContext';

export function PrototypeMenu() {
  const services = useServices();
  const { status, unpair } = usePairing();
  const { actor } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function go(path: string) {
    setOpen(false);
    navigate(path);
  }

  async function reset() {
    setOpen(false);
    const ok = window.confirm(
      'Reset this device? Clears all local demo data on this device (card, sign-in, points) so you can run a workflow from scratch.',
    );
    if (!ok) return;
    await services.reset();
    localStorage.clear();
    sessionStorage.clear();
    // Reload (not just a hash change) so services re-init and reseed; land on home.
    window.location.hash = '#/';
    window.location.reload();
  }

  return (
    <div className="proto-menu" ref={ref}>
      <button
        type="button"
        className="proto-tag"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Prototype tools"
        onClick={() => setOpen((v) => !v)}
      >
        prototype {status === 'paired' ? '●' : '▾'}
      </button>
      {open && (
        <div className="proto-dropdown" role="menu">
          <p className="proto-dropdown-head">Prototype tools</p>
          {status === 'paired' ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                unpair();
              }}
            >
              ● Paired — unpair
            </button>
          ) : (
            <button type="button" role="menuitem" onClick={() => go('/pair')}>
              {status === 'hosting' || status === 'connecting' ? 'Pairing…' : 'Pair a device'}
            </button>
          )}
          {!actor && (
            <button type="button" role="menuitem" onClick={() => go('/login')}>
              Staff / admin sign in
            </button>
          )}
          <button type="button" role="menuitem" className="danger" onClick={reset}>
            Reset this device
          </button>
        </div>
      )}
    </div>
  );
}
