/**
 * DevTrigger — the prototype-only hidden tap target that opens the developer
 * (Prototype tools) panel.
 *
 * A small, deliberately near-invisible button fixed to the TOP-LEFT corner of
 * every view. It replaces the old "right-half tap on the logo" gesture so the
 * logo can be a clean "go home" affordance without competing with redirects.
 *
 * Build-flag gated by the caller (App renders it only when `isPrototype`); it
 * has no production equivalent and is stripped from server-backed builds.
 */
import './dev-trigger.css';

export interface DevTriggerProps {
  onOpen: () => void;
}

export function DevTrigger({ onOpen }: DevTriggerProps): JSX.Element {
  return (
    <button
      type="button"
      className="dev-trigger"
      aria-label="Open developer tools (prototype only)"
      onClick={onOpen}
    />
  );
}

export default DevTrigger;
