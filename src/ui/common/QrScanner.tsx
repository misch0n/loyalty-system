/**
 * QrScanner — camera scan with a manual-entry fallback.
 *
 * Camera needs a secure context (HTTPS/localhost). When it is unavailable (or
 * for quick demos), staff can paste/type the token instead. Resolves to the
 * decoded text; the caller looks the customer up by token.
 */

import { useEffect, useRef, useState } from 'react';
import { startScanner, type ScannerHandle } from '../../qr/scan';

interface Props {
  onResult: (text: string) => void;
  /** Label for the manual field, e.g. "Customer token" or "Session code". */
  manualLabel?: string;
  /** Hide the type/paste fallback (e.g. pairing, where there's no code to type). */
  allowManual?: boolean;
}

const ELEMENT_ID = 'qr-scanner-region';

export function QrScanner({ onResult, manualLabel = 'Customer token', allowManual = true }: Props) {
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<ScannerHandle | null>(null);

  useEffect(() => {
    return () => {
      handleRef.current?.stop();
    };
  }, []);

  async function start() {
    setError(null);
    try {
      handleRef.current = await startScanner(ELEMENT_ID, async (text) => {
        await handleRef.current?.stop();
        handleRef.current = null;
        setScanning(false);
        onResult(text.trim());
      });
      setScanning(true);
    } catch {
      setError('Camera unavailable. Type or paste the code below instead.');
      setScanning(false);
    }
  }

  async function stop() {
    await handleRef.current?.stop();
    handleRef.current = null;
    setScanning(false);
  }

  function submitManual(e: React.FormEvent) {
    e.preventDefault();
    const value = manual.trim();
    if (value) onResult(value);
  }

  return (
    <div className="scanner">
      <div id={ELEMENT_ID} className="scanner-region" hidden={!scanning} />
      <div className="scanner-actions">
        {scanning ? (
          <button type="button" onClick={stop}>
            Stop camera
          </button>
        ) : (
          <button type="button" onClick={start}>
            Scan with camera
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {allowManual && (
      <form className="manual-entry" onSubmit={submitManual}>
        <label>
          {manualLabel}
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Paste code"
            autoComplete="off"
          />
        </label>
        <button type="submit" disabled={!manual.trim()}>
          Look up
        </button>
      </form>
      )}
    </div>
  );
}
