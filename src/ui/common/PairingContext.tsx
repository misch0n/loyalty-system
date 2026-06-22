/**
 * PairingContext — prototype device pairing (the server stand-in).
 *
 * Pair two devices over PeerJS for the session: the staff device HOSTS (shows a
 * pairing QR) and the customer device JOINS by scanning it. While paired, the
 * joined device's store is re-pointed at the host's store over the link, so every
 * workflow reflects on both devices. `dataVersion` bumps whenever shared data
 * changes, so screens can refetch live. Prototype-only — production uses a server.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useServices } from './ServicesContext';
import { PeerJsLink } from '../../adapters/sync/PeerJsLink';
import { createStoreServer } from '../../adapters/sync/StoreServer';
import { createPeerClientStore } from '../../adapters/sync/PeerClientStore';
import type { PeerLink } from '../../adapters/sync/PeerLink';

export type PairStatus = 'idle' | 'hosting' | 'connecting' | 'paired' | 'error';
export type PairRole = 'host' | 'client';

interface PairingValue {
  status: PairStatus;
  role: PairRole | null;
  /** The host's peer id — encode this in the pairing QR while hosting. */
  peerId: string | null;
  error: string | null;
  /** Bumps when shared data changes; add to effect deps to refetch live. */
  dataVersion: number;
  startHosting: () => Promise<void>;
  joinAs: (remoteId: string) => Promise<void>;
  unpair: () => void;
}

const PairingContext = createContext<PairingValue | null>(null);

export function PairingProvider({ children }: { children: ReactNode }) {
  const services = useServices();
  const [status, setStatus] = useState<PairStatus>('idle');
  const [role, setRole] = useState<PairRole | null>(null);
  const [peerId, setPeerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);

  const bump = useCallback(() => setDataVersion((v) => v + 1), []);
  const linkRef = useRef<PeerLink | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Any local mutation should refresh this device's own screens too.
  useEffect(() => services.sync.observable.onMutate(bump), [services, bump]);

  const teardown = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    linkRef.current?.close();
    linkRef.current = null;
  }, []);

  const unpair = useCallback(() => {
    // Revert the live store to local (a no-op on the host, which never switched).
    services.sync.switchable.setTarget(services.sync.observable.store);
    teardown();
    setStatus('idle');
    setRole(null);
    setPeerId(null);
    setError(null);
    bump();
  }, [services, teardown, bump]);

  const startHosting = useCallback(async () => {
    try {
      setError(null);
      setStatus('hosting');
      setRole('host');
      const { link, peerId: hostId } = await PeerJsLink.host();
      linkRef.current = link;
      setPeerId(hostId);
      const server = createStoreServer(services.sync.observable, link);
      const offState = link.onState((s) => {
        if (s === 'open') setStatus('paired');
        if (s === 'closed') unpair();
      });
      cleanupRef.current = () => {
        offState();
        server.dispose();
      };
    } catch {
      setError('Could not start pairing. Check your connection and try again.');
      setStatus('error');
      setRole(null);
    }
  }, [services, unpair]);

  const joinAs = useCallback(
    async (remoteId: string) => {
      try {
        setError(null);
        setStatus('connecting');
        setRole('client');
        const link = await PeerJsLink.join(remoteId.trim());
        linkRef.current = link;
        const client = createPeerClientStore(link);
        services.sync.switchable.setTarget(client.store);
        const offChanged = client.onChanged(bump);
        const offState = link.onState((s) => {
          if (s === 'closed') unpair();
        });
        cleanupRef.current = () => {
          offChanged();
          offState();
          client.dispose();
        };
        setStatus('paired');
        bump(); // first refresh now reads from the paired host
      } catch {
        services.sync.switchable.setTarget(services.sync.observable.store);
        setError(
          'Couldn’t connect to the till. Have staff re-open the pairing code, check both devices are online, then scan again.',
        );
        setStatus('error');
        setRole(null);
      }
    },
    [services, unpair, bump],
  );

  // Tear down the link if the app unmounts.
  useEffect(() => () => teardown(), [teardown]);

  const value = useMemo<PairingValue>(
    () => ({ status, role, peerId, error, dataVersion, startHosting, joinAs, unpair }),
    [status, role, peerId, error, dataVersion, startHosting, joinAs, unpair],
  );

  return <PairingContext.Provider value={value}>{children}</PairingContext.Provider>;
}

export function usePairing(): PairingValue {
  const ctx = useContext(PairingContext);
  if (!ctx) throw new Error('usePairing must be used within a PairingProvider.');
  return ctx;
}
