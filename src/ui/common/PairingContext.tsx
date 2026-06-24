/**
 * PairingContext — prototype device pairing (the server stand-in).
 *
 * Every device can HOST: it shows a pairing QR and accepts MANY customer devices.
 * Scanning another device's QR makes this device a CLIENT of that till (its store
 * is re-pointed at the till's over PeerJS). To let a network grow from ANY device,
 * a client also surfaces the HOST's id (`joinedHostId`) so it can show the host's
 * QR — a third device scanning a client's screen still connects straight to the
 * host. `dataVersion` bumps on shared-data changes so screens refetch live.
 *
 * Pairing is a reversible, non-destructive overlay (see `storageSnapshot`):
 *   - join  → snapshot this device's storage, then start fresh (a new customer).
 *   - unpair (voluntary OR forced by the host) → restore the snapshot, re-resolve.
 * Reset is role-aware: a paired client clears only its own storage (the host keeps
 * all data); a host/unpaired device fully wipes + reseeds its store in place.
 *
 * Prototype-only — production uses a server and drops this entire layer.
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
import { useAuth } from '../app/AuthContext';
import { useToast } from '../components/Toast/Toast';
import { ROUTES } from '../app/routes';
import {
  clearAllStorage,
  clearExceptSnapshot,
  restoreSnapshot,
  snapshotAndClear,
} from './storageSnapshot';
import { joinHost, PeerJsHost } from '../../adapters/sync/PeerJsLink';
import { createStoreServer } from '../../adapters/sync/StoreServer';
import { createPeerClientStore } from '../../adapters/sync/PeerClientStore';
import type { PeerLink } from '../../adapters/sync/PeerLink';

interface PairingValue {
  /** This device's host peer id — encode in the pairing QR while hosting. */
  peerId: string | null;
  /** The till's id we're paired to (as a client) — show its QR so others can join. */
  joinedHostId: string | null;
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
   * Scan a till's id to pair as its customer. By default routes to the welcome
   * screen on success (any device joining the network starts as a fresh visitor);
   * pass `{ redirect: false }` to stay put (the dev panel pairs in place and shows
   * a "Paired" state instead of navigating away).
   */
  joinAs: (remoteId: string, opts?: { redirect?: boolean }) => Promise<void>;
  /** Host: drop all clients. Client: leave the till. Either way, signal the peers. */
  unpair: () => void;
  /**
   * Role-aware demo reset (prototype). Paired client → clear only this device's
   * storage (keep the snapshot + the live link; act as a brand-new customer).
   * Host / unpaired → drop any clients, wipe + reseed the local store, clear all
   * storage. Re-resolves in place — no page reload.
   */
  reset: () => Promise<void>;
}

const PairingContext = createContext<PairingValue | null>(null);

export function PairingProvider({ children }: { children: ReactNode }) {
  const services = useServices();
  const navigate = useNavigate();
  const auth = useAuth();
  const toast = useToast();

  const [peerId, setPeerId] = useState<string | null>(null);
  const [joinedHostId, setJoinedHostId] = useState<string | null>(null);
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
        // Just track the count — the till is NOT auto-routed to staff sign-in;
        // it stays wherever it is so the host can be a plain customer too.
        const offCount = host.onCountChange((n) => setClientCount(n));
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
  }, [services]);

  const revertToHostReady = useCallback(
    (forced = false) => {
      if (!joinedRef.current) return;
      services.sync.switchable.setTarget(services.sync.observable.store);
      clientCleanupRef.current?.();
      clientCleanupRef.current = null;
      clientLinkRef.current?.close();
      clientLinkRef.current = null;
      joinedRef.current = false;
      setJoined(false);
      setJoinedHostId(null);
      // Pop the pre-pair storage back, then re-resolve to whatever we were before.
      restoreSnapshot();
      bump();
      if (forced) {
        toast.show("The till disconnected — you've been unpaired.", { duration: 4000 });
      }
      navigate('/', { replace: true });
      ensureHosting(); // resume hosting so this device shows its own QR again
    },
    [services, bump, ensureHosting, navigate, toast],
  );

  const joinAs = useCallback(
    async (remoteId: string, opts?: { redirect?: boolean }) => {
      setError(null);
      setConnecting(true);
      try {
        stopHosting(); // a client can't also be a till
        const id = remoteId.trim();
        const link = await joinHost(id);
        joinedRef.current = true;
        setJoined(true);
        setJoinedHostId(id);
        stopHosting(); // close any host that started racing while we connected
        clientLinkRef.current = link;
        const client = createPeerClientStore(link);
        services.sync.switchable.setTarget(client.store);
        const offChanged = client.onChanged(bump);
        const offState = link.onState((s) => {
          if (s === 'closed') revertToHostReady(true);
        });
        const offMsg = link.onMessage((m) => {
          if ((m as { t?: string }).t === 'unpair') revertToHostReady(true);
        });
        clientCleanupRef.current = () => {
          offChanged();
          offState();
          offMsg();
          client.dispose();
        };
        // Start fresh as a new customer on this till: snapshot our own storage
        // (restored on unpair) and clear it, then drop any signed-in session.
        snapshotAndClear();
        auth.logout();
        bump();
        if (opts?.redirect !== false) {
          navigate(ROUTES.welcome, { replace: true }); // any joiner → welcome
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
    [services, bump, navigate, ensureHosting, revertToHostReady, stopHosting, auth],
  );

  const unpair = useCallback(() => {
    if (joinedRef.current) {
      clientLinkRef.current?.send({ t: 'unpair' });
      revertToHostReady(false); // voluntary — no toast
    } else {
      hostRef.current?.unpairAll(); // signals + drops every client; count → 0
    }
  }, [revertToHostReady]);

  const reset = useCallback(async () => {
    if (joinedRef.current) {
      // Paired client: light reset. Clear this device's storage (keep the pairing
      // snapshot + the live RPC link) so it behaves like a brand-new customer
      // joining an existing program — the host keeps all the data.
      clearExceptSnapshot();
      auth.logout();
      navigate('/', { replace: true });
      return;
    }
    // Host or unpaired device: full reset. Clear the device-visible state FIRST
    // (so recognition can't survive even if the data wipe throws), then empty +
    // re-seed the store in place — which no longer deletes the DB, so it can't
    // hang. Awaiting it means the seeded store is ready before we land on welcome.
    hostRef.current?.unpairAll();
    clearAllStorage();
    auth.logout();
    await services.reset().catch(() => {
      // best-effort data wipe; the device-visible reset already happened above
    });
    navigate('/', { replace: true });
  }, [services, auth, navigate]);

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
      joinedHostId,
      hosting,
      clientCount,
      joined,
      connecting,
      error,
      dataVersion,
      ensureHosting,
      joinAs,
      unpair,
      reset,
    }),
    [
      peerId,
      joinedHostId,
      hosting,
      clientCount,
      joined,
      connecting,
      error,
      dataVersion,
      ensureHosting,
      joinAs,
      unpair,
      reset,
    ],
  );

  return <PairingContext.Provider value={value}>{children}</PairingContext.Provider>;
}

export function usePairing(): PairingValue {
  const ctx = useContext(PairingContext);
  if (!ctx) throw new Error('usePairing must be used within a PairingProvider.');
  return ctx;
}
