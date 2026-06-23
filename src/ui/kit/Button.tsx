/**
 * Button — the kit's single action control (UI-SPEC §3).
 *
 * Variants:
 *   sage   — primary on a dark/forest surface
 *   forest — primary on a light surface
 *   line   — outline / secondary
 *   ghost  — text link
 *   wallet — dark pill with a leading glyph (Apple/Google wallet)
 *
 * Disabled = reduced opacity + not-allowed. Visible :focus-visible terra ring
 * (from theme.css), active press. Set `as="a"` to render an anchor for links
 * while keeping button styling.
 */
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
} from 'react';

export type ButtonVariant = 'sage' | 'forest' | 'line' | 'ghost' | 'wallet';
export type ButtonSize = 'md' | 'lg';

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to fill the container width. */
  block?: boolean;
  /** Optional leading glyph/icon (used by the wallet variant, but general). */
  leading?: ReactNode;
  children: ReactNode;
  className?: string;
}

type AsButton = CommonProps & {
  as?: 'button';
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps>;

type AsAnchor = CommonProps & {
  as: 'a';
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof CommonProps>;

export type ButtonProps = AsButton | AsAnchor;

function classes(p: CommonProps): string {
  return [
    'kit-btn',
    `kit-btn--${p.variant ?? 'forest'}`,
    `kit-btn--${p.size ?? 'md'}`,
    p.block ? 'kit-btn--block' : '',
    p.className,
  ]
    .filter(Boolean)
    .join(' ');
}

export function Button(props: ButtonProps) {
  const { variant, size, block, leading, children, className, ...rest } = props as CommonProps & {
    as?: 'button' | 'a';
  };
  const cls = classes({ variant, size, block, children, className });
  const body = (
    <>
      {leading != null && <span className="kit-btn__glyph" aria-hidden="true">{leading}</span>}
      <span className="kit-btn__label">{children}</span>
    </>
  );

  if (props.as === 'a') {
    const { as: _as, ...anchorRest } = rest as { as?: 'a' } & AnchorHTMLAttributes<HTMLAnchorElement>;
    void _as;
    return (
      <a className={cls} {...anchorRest}>
        {body}
      </a>
    );
  }

  const { as: _as, ...buttonRest } = rest as { as?: 'button' } & ButtonHTMLAttributes<HTMLButtonElement>;
  void _as;
  return (
    <button className={cls} {...buttonRest}>
      {body}
    </button>
  );
}
