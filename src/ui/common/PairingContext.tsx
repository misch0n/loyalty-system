/**
 * PairingContext — prototype device pairing (the server stand-in).
 *
 * Every device can HOST: it shows its own pairing QR and accepts MANY customer
 * devices. Scanning another device's QR instead makes this device a CLIENT of
 * that till (its store is re-pointed at the till's over PeerJS). A till keeps its
 * QR up and reports how many devices are paired; a client shows a paired label.
 * Unpairing signals every connected device. `dataVersion` bumps on shared-data
 * changes so screens refetch live. Prototype-only — production uses a server.
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
import { useNavigate } from 'react-router-dom';
import { useServices } from './ServicesContext';
import { joinHost, PeerJsHost } from '../../adapters/sync/PeerJsLink';
import { createStoreServer } from '../../adapters/sync/StoreServer';
import { createPeerClientStore } from '../../adapters/sync/PeerClientStore';
import type { PeerLink } from '../../adapters/sync/PeerLink';

interface PairingValue {
  /** This device's host peer id — encode in the pairing QR while hosting. */
  peerId: string | null;
  /** Our host peer is active (we can be scanned). */
  hosting: boolean;
  /** Customer devices currently paired to us (we're the till). */
  clientCount: number;
  /** We scanned a till and are its customer. */
  joined: boolean;
  /** A join is in progress. */
  connecting: boolean;
  error: string | null;
  /** Bumps when shared data changes; add to effect deps to refetch live. */
  dataVersion: number;
  /** Start hosting if idle (so a QR is available). No-op if already hosting/joined. */
  ensureHosting: () => void;
  /**
   * Scan a till's id to pair as its customer. By default routes to the customer
   * home on success; pass `{ redirect: false }` to stay put (the dev panel pairs
   * in place and shows a "Paired" state instead of navigating away).
   */
  joinAs: (remoteId: string, opts?: { redirect?: boolean }) => Promise<void>;
  /** Host: drop all clients. Client: leave the till. Either way, signal the peers. */
  unpair: () => void;
}

const PairingContext = createContext<PairingValue | null>(null);

function inStaffArea(): boolean {
  const h = window.location.hash;
  return h.startsWith('#/staff') || h.startsWith('#/admin');
}

export function PairingProvider({ children }: { children: ReactNode }) {
  const services = useServices();
  const navigate = useNavigate();

  const [peerId, setPeerId] = useState<string | null>(null);
  const [hosting, setHosting] = useState(false);
  const [clientCount, setClientCount] = useState(0);
  const [joined, setJoined] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);

  const bump = useCallback(() => setDataVersion((v) => v + 1), []);

  const hostRef = useRef<PeerJsHost | null>(null);
  const hostCleanupRef = useRef<(() => void) | null>(null);
  const startingHostRef = useRef(false);
  const prevCountRef = useRef(0);
  const clientLinkRef = useRef<PeerLink | null>(null);
  const clientCleanupRef = useRef<(() => void) | null>(null);
  const joinedRef = useRef(false);

  // Any local mutation refreshes this device's own screens too (host side).
  useEffect(() => services.sync.observable.onMutate(bump), [services, bump]);

  const stopHosting = useCallback(() => {
    hostCleanupRef.current?.();
    hostCleanupRef.current = null;
    hostRef.current?.close();
    hostRef.current = null;
    prevCountRef.current = 0;
    setHosting(false);
    setPeerId(null);
    setClientCount(0);
  }, []);

  const ensureHosting = useCallback(() => {
    if (joinedRef.current || hostRef.current || startingHostRef.current) return;
    startingHostRef.current = true;
    void (async () => {
      try {
        const { host, peerId: id } = await PeerJsHost.create();
        if (joinedRef.current) {
          host.close(); // became a client while we were starting up
          return;
        }
        hostRef.current = host;
        setPeerId(id);
        setHosting(true);
        // One StoreServer per connected client → change notifications fan out to all.
        const offClient = host.onClient((link) => {
          const server = createStoreServer(services.sync.observable, link);
          link.onState((s) => {
            if (s === 'closed') server.dispose();
          });
        });
        const offCount = host.onCountChange((n) => {
          setClientCount(n);
          // First customer paired → this device is the till; send it to staff.
          if (prevCountRef.current === 0 && n > 0 && !inStaffArea()) {
            navigate('/staff', { replace: true });
          }
          prevCountRef.current = n;
        });
        hostCleanupRef.current = () => {
          offClient();
          offCount();
        };
      } catch {
        setError('Could not start pairing. Check your connection and try again.');
      } finally {
        startingHostRef.current = false;
      }
    })();
  }, [services, navigate]);

  const revertToHostReady = useCallback(() => {
    if (!joinedRef.current) return;
    services.sync.switchable.setTarget(services.sync.observable.store);
    clientCleanupRef.current?.();
    clientCleanupRef.current = null;
    clientLinkRef.current?.close();
    clientLinkRef.current = null;
    joinedRef.current = false;
    setJoined(false);
    bump();
    ensureHosting(); // resume hosting so this device shows its QR again
  }, [services, bump, ensureHosting]);

  const joinAs = useCallback(
    async (remoteId: string, opts?: { redirect?: boolean }) => {
      setError(null);
      setConnecting(true);
      try {
        stopHosting(); // a client can't also be a till
        const link = await joinHost(remoteId.trim());
        joinedRef.current = true;
        setJoined(true);
        stopHosting(); // close any host that started racing while we connected
        clientLinkRef.current = link;
        const client = createPeerClientStore(link);
        services.sync.switchable.setTarget(client.store);
        const offChanged = client.onChanged(bump);
        const offState = link.onState((s) => {
          if (s === 'closed') revertToHostReady();
        });
        const offMsg = link.onMessage((m) => {
          if ((m as { t?: string }).t === 'unpair') revertToHostReady();
        });
        clientCleanupRef.current = () => {
          offChanged();
          offState();
          offMsg();
          client.dispose();
        };
        bump();
        if (opts?.redirect !== false) {
          navigate('/', { replace: true }); // customer → home
        }
      } catch {
        services.sync.switchable.setTarget(services.sync.observable.store);
        setError(
          'Couldn’t connect to the till. Have staff re-open the pairing code, check both devices are online, then scan again.',
        );
        ensureHosting();
      } finally {
        setConnecting(false);
      }
    },
    [services, bump, navigate, ensureHosting, revertToHostReady, stopHosting],
  );

  const unpair = useCallback(() => {
    if (joinedRef.current) {
      clientLinkRef.current?.send({ t: 'unpair' });
      revertToHostReady();
    } else {
      hostRef.current?.unpairAll(); // signals + drops every client; count → 0
    }
  }, [revertToHostReady]);

  // Tear everything down on unmount.
  useEffect(
    () => () => {
      clientCleanupRef.current?.();
      clientLinkRef.current?.close();
      hostCleanupRef.current?.();
      hostRef.current?.close();
    },
    [],
  );

  const value = useMemo<PairingValue>(
    () => ({
      peerId,
      hosting,
      clientCount,
      joined,
      connecting,
      error,
      dataVersion,
      ensureHosting,
      joinAs,
      unpair,
    }),
    [peerId, hosting, clientCount, joined, connecting, error, dataVersion, ensureHosting, joinAs, unpair],
  );

  return <PairingContext.Provider value={value}>{children}</PairingContext.Provider>;
}

export function usePairing(): PairingValue {
  const ctx = useContext(PairingContext);
  if (!ctx) throw new Error('usePairing must be used within a PairingProvider.');
  return ctx;
}
