/**
 * storageSnapshot — prototype pairing storage lifecycle (push/pop).
 *
 * PROTOTYPE-ONLY. Pairing as a client must "start fresh" (no leftover card /
 * sign-in from before) yet be perfectly reversible. We model that as a stack of
 * exactly one frame:
 *   - on pair  → SNAPSHOT the device's own local + session storage into a single
 *                reserved key, then clear everything else (fresh paired device).
 *   - on unpair → RESTORE that frame and drop the reserved key (back to pre-pair).
 *
 * The reserved key is written ONLY here and read ONLY by restore — never used as
 * app state. Its mere presence is meaningful: because a PeerJS connection never
 * survives a page load, a device is never legitimately paired at boot, so a
 * snapshot found at startup can only mean the last session didn't unpair cleanly
 * (a paired tab was closed). Boot calls `restoreSnapshot()` to self-heal.
 *
 * No PII is logged; all access is wrapped so storage-disabled environments
 * (Safari private mode) degrade quietly instead of throwing.
 */

const RESERVED_KEY = 'cafe-loyalty.__pairSnapshot';

interface StorageFrame {
  local: Record<string, string>;
  session: Record<string, string>;
}

/** All entries of a Storage as a plain map, excluding the reserved key itself. */
function readAll(s: Storage): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i);
    if (key && key !== RESERVED_KEY) {
      const value = s.getItem(key);
      if (value !== null) out[key] = value;
    }
  }
  return out;
}

/** Is there a pairing snapshot on this device right now? */
export function hasSnapshot(): boolean {
  try {
    return localStorage.getItem(RESERVED_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Capture local + session storage into the reserved key, then clear everything
 * else — the device starts fresh as a paired client. Call on a successful pair.
 */
export function snapshotAndClear(): void {
  try {
    const frame: StorageFrame = {
      local: readAll(localStorage),
      session: readAll(sessionStorage),
    };
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem(RESERVED_KEY, JSON.stringify(frame));
  } catch {
    // Storage unavailable → best-effort: pairing still works, just not reversible.
  }
}

/**
 * Restore the captured storage frame and drop the reserved key. Used on unpair
 * (voluntary or forced) and as boot self-healing. Returns true if a frame was
 * found and restored.
 */
export function restoreSnapshot(): boolean {
  try {
    const raw = localStorage.getItem(RESERVED_KEY);
    if (raw === null) return false;
    let frame: StorageFrame | null = null;
    try {
      frame = JSON.parse(raw) as StorageFrame;
    } catch {
      // Corrupt frame: drop it so we don't loop on it, and fall through.
    }
    localStorage.clear();
    sessionStorage.clear();
    if (frame) {
      for (const [k, v] of Object.entries(frame.local ?? {})) localStorage.setItem(k, v);
      for (const [k, v] of Object.entries(frame.session ?? {})) sessionStorage.setItem(k, v);
    }
    return frame !== null;
  } catch {
    return false;
  }
}

/**
 * Light (paired-client) reset: clear everything EXCEPT the pairing snapshot, so
 * the device behaves like a brand-new customer while staying reversible on
 * unpair. The host keeps all the real data (we're RPC'd to it).
 */
export function clearExceptSnapshot(): void {
  try {
    const reserved = localStorage.getItem(RESERVED_KEY);
    localStorage.clear();
    sessionStorage.clear();
    if (reserved !== null) localStorage.setItem(RESERVED_KEY, reserved);
  } catch {
    // best-effort
  }
}

/** Full reset: clear all storage, including any snapshot. Host / unpaired device. */
export function clearAllStorage(): void {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    // best-effort
  }
}
