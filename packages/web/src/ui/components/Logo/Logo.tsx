import './Logo.css';

/**
 * The Ckyka mark: a top-down cup + sunburst crema + handle.
 * Ports `mock.js buildMark` to JSX — a stroked ring, 30 radial rays, a center
 * dot, and a handle path. Colored via `currentColor`.
 */
export interface LogoMarkProps {
  className?: string;
  /** When 'sm', applies the `.sm` modifier (30px). Default renders at 74px. */
  size?: 'sm';
}

const RAY_COUNT = 30;
const RAY_R1 = 11.5;
const RAY_R2 = 26;
const CX = 50;
const CY = 46;

const rays = Array.from({ length: RAY_COUNT }, (_, i) => {
  const a = (i / RAY_COUNT) * Math.PI * 2;
  return {
    x1: (CX + Math.cos(a) * RAY_R1).toFixed(2),
    y1: (CY + Math.sin(a) * RAY_R1).toFixed(2),
    x2: (CX + Math.cos(a) * RAY_R2).toFixed(2),
    y2: (CY + Math.sin(a) * RAY_R2).toFixed(2),
  };
});

export function LogoMark({ className, size }: LogoMarkProps) {
  const classes = ['mark', size === 'sm' ? 'sm' : null, className]
    .filter(Boolean)
    .join(' ');
  return (
    <svg className={classes} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <circle cx={CX} cy={CY} r={30} stroke="currentColor" strokeWidth={3.4} />
      <g>
        {rays.map((r, i) => (
          <line
            key={i}
            x1={r.x1}
            y1={r.y1}
            x2={r.x2}
            y2={r.y2}
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
          />
        ))}
      </g>
      <circle cx={CX} cy={CY} r={7.5} fill="currentColor" />
      <path
        d="M79 40 q12 6 0 18"
        stroke="currentColor"
        strokeWidth={3.4}
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The stacked logo lockup: mark + optional wordmark + optional sub-label. */
export interface LockupProps {
  word?: string;
  sub?: string;
  size?: 'sm';
}

export function Lockup({ word, sub, size }: LockupProps) {
  return (
    <div className="lockup">
      <LogoMark size={size} />
      {word ? <div className="word">{word}</div> : null}
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}
