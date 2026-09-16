/**
 * Camera scanning wrapper (html5-qrcode).
 *
 * Thin, framework-free wrapper so UI components don't depend on the scanner lib
 * directly. Camera access needs a secure context (HTTPS / localhost); GitHub
 * Pages is HTTPS so this works in the deployed prototype.
 */

import { Html5Qrcode } from 'html5-qrcode';

export interface ScannerHandle {
  stop: () => Promise<void>;
}

/**
 * Start scanning into the element with the given id. Calls `onResult` with the
 * decoded text on each successful read. Returns a handle to stop the camera.
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
  };
}
