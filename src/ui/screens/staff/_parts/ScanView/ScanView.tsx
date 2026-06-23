/**
 * ScanView — the camera viewport for the staff scan workflow (Ckyka view 10,
 * state 1 "scanning").
 *
 * Donor `.scanview`: a dark rounded panel with a `.frame` (four `<i>` corner
 * brackets), an animated `.laser` sweep, and a `.cap` caption. When `videoSlot`
 * is provided the live camera element is mounted inside the frame; otherwise the
 * animated mock viewport stands in. Pure presentation — the screen owns the
 * camera lifecycle and passes in the region node.
 */
import type { ReactNode } from 'react';
import './ScanView.css';

export interface ScanViewProps {
  /** Caption under the frame. Defaults to "Point at the customer's code". */
  caption?: string;
  /** Live camera element (e.g. the scanner region div). */
  videoSlot?: ReactNode;
}

export function ScanView({
  caption = "Point at the customer's code",
  videoSlot,
}: ScanViewProps): JSX.Element {
  return (
    <div className="scanview">
      {videoSlot != null && <div className="scanview__video">{videoSlot}</div>}
      <div className="frame">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="laser" />
      <div className="cap">{caption}</div>
    </div>
  );
}
