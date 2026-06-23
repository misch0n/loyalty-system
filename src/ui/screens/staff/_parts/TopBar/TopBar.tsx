/**
 * TopBar — forest staff header (Ckyka views 09 + 10).
 *
 * Donor `.topbar`: a `.tl` lockup (the gesture-bearing Ckyka mark + `.tt`
 * wordmark) on the left and a mono `.role` pill on the right. The mark is
 * wrapped in `<GestureLogo>` so the logo gestures (home / tools / hold→sign-in)
 * stay reachable from every staff screen — there is no global chrome.
 *
 * `onShift` is convenience: when given, the `.onshift` line is rendered just
 * BELOW the bar. Screens that need finer control can use `<OnShift>` directly.
 */
import { GestureLogo } from '../../../../app/LogoGestures';
import { LogoMark } from '../../../../components/Logo/Logo';
import './TopBar.css';

export interface TopBarProps {
  /** Mono role pill text (e.g. "Counter"). Defaults to "Counter". */
  role?: string;
  /** When set, renders an `.onshift` line below the bar with this name. */
  onShift?: string;
}

export function TopBar({ role = 'Counter', onShift }: TopBarProps): JSX.Element {
  return (
    <>
      <div className="topbar">
        <GestureLogo className="tl">
          <LogoMark />
          <span className="tt">Ckyka</span>
        </GestureLogo>
        <span className="role">{role}</span>
      </div>
      {onShift != null && <OnShift name={onShift} />}
    </>
  );
}

export interface OnShiftProps {
  /** The signed-in staff name shown after "On shift · ". */
  name: string;
}

/** The mono "On shift · {name}" line (donor `.onshift`). */
export function OnShift({ name }: OnShiftProps): JSX.Element {
  return <div className="onshift">On shift · {name}</div>;
}
