/**
 * Camera scanning wrapper (html5-qrcode).
 *
 * Thin, framework-free wrapper so UI components don't depend on the scanner lib
 * directly. Camera access needs a secure context (HTTPS / localhost); GitHub
 * Pages is HTTPS so this works in the deployed prototype.
 */

import { Html5Qrcode } from 'html5-qrcode';

export interface ScannerHandle {
  /** Fully release the camera (stops the track — the camera indicator turns off). */
  stop: () => Promise<void>;
  /** Pause decoding but KEEP the camera stream, so resuming needs no new
   *  getUserMedia (and so no repeat permission prompt). */
  pause: () => void;
  /** Resume decoding on the kept stream. */
  resume: () => void;
}

/**
 * Start scanning into the element with the given id. Calls `onResult` with the
 * decoded text on each successful read.
 *
 * The returned handle exposes pause/resume in addition to stop: between scans we
 * PAUSE (keeping the acquired stream) rather than stop, so the browser doesn't
 * re-request the camera — which on iOS Safari means it won't re-prompt for
 * permission on every customer. `stop` is reserved for leaving the scan screen.
 */
export async function startScanner(
  elementId: string,
  onResult: (text: string) => void,
  onError?: (message: string) => void,
): Promise<ScannerHandle> {
  const scanner = new Html5Qrcode(elementId);
  await scanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 220, height: 220 } },
    (decodedText) => onResult(decodedText),
    (errorMessage) => onError?.(errorMessage),
  );
  return {
    stop: async () => {
      try {
        await scanner.stop();
        scanner.clear();
      } catch {
        // Already stopped — ignore.
      }
    },
    pause: () => {
      try {
        scanner.pause(true); // also pause the <video> element
      } catch {
        // Not in a pausable state — ignore.
      }
    },
    resume: () => {
      try {
        scanner.resume();
      } catch {
        // Not in a resumable state — ignore.
      }
    },
  };
}
