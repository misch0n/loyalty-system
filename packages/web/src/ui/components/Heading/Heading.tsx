import type { CSSProperties, ReactNode } from 'react';
import './Heading.css';

export interface HeadingProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

function cx(base: string, extra?: string) {
  return extra ? `${base} ${extra}` : base;
}

/** Mono uppercase kicker above a title (`.h-eyebrow`). */
export function Eyebrow({ children, className, style }: HeadingProps) {
  return (
    <div className={cx('h-eyebrow', className)} style={style}>
      {children}
    </div>
  );
}

/** Serif page title (`.h-title`). */
export function Title({ children, className, style }: HeadingProps) {
  return (
    <h1 className={cx('h-title', className)} style={style}>
      {children}
    </h1>
  );
}

/** Muted supporting line under a title (`.h-sub`). */
export function Sub({ children, className, style }: HeadingProps) {
  return (
    <p className={cx('h-sub', className)} style={style}>
      {children}
    </p>
  );
}
