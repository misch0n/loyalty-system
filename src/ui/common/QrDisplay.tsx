/** Renders a payload as a QR image. PII never goes in here — tokens/routes only. */

import { useEffect, useState } from 'react';
import { toDataUrl } from '../../qr/encode';

interface Props {
  payload: string;
  label?: string;
  caption?: string;
}

export function QrDisplay({ payload, label, caption }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    toDataUrl(payload)
      .then((url) => active && setSrc(url))
      .catch(() => active && setError('Could not render the QR code.'));
    return () => {
      active = false;
    };
  }, [payload]);

  return (
    <figure className="qr">
      {error ? (
        <p className="error">{error}</p>
      ) : src ? (
        <img src={src} alt={label ?? 'QR code'} width={240} height={240} />
      ) : (
        <p>Rendering…</p>
      )}
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
