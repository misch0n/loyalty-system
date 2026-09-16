import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
} from 'react';
import './Button.css';

export type ButtonVariant = 'sage' | 'forest' | 'ghost' | 'line';

type ButtonOwnProps = {
  variant?: ButtonVariant;
  children?: ReactNode;
  className?: string;
};

type AsButton = ButtonOwnProps & {
  as?: 'button';
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>;

type AsAnchor = ButtonOwnProps & {
  as: 'a';
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'children'>;

export type ButtonProps = AsButton | AsAnchor;

function classes(variant: ButtonVariant, className?: string) {
  return ['btn', `btn-${variant}`, className].filter(Boolean).join(' ');
}

/**
 * The primary action button (`.btn .btn-<variant>`). Renders a `<button>` by
 * default, or an `<a>` when `as="a"`. Default variant is forest.
 */
export function Button(props: ButtonProps) {
  const { variant = 'forest', className, children } = props;
  const cls = classes(variant, className);

  if (props.as === 'a') {
    const { variant: _v, className: _c, children: _ch, as: _as, ...rest } = props;
    void _v;
    void _c;
    void _ch;
    void _as;
    return (
      <a className={cls} {...rest}>
        {children}
      </a>
    );
  }

  const { variant: _v, className: _c, children: _ch, as: _as, type, ...rest } = props;
  void _v;
  void _c;
  void _ch;
  void _as;
  return (
    <button className={cls} type={type ?? 'button'} {...rest}>
      {children}
    </button>
  );
}

export type WalletOs = 'apple' | 'google';

export interface WalletButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  os?: WalletOs;
  className?: string;
}

const APPLE_PATH =
  'M17 3a4.6 4.6 0 0 0-3.1 1.6A4.2 4.2 0 0 0 13 7.7a4 4 0 0 0 3-1.5A4.5 4.5 0 0 0 17 3zm2.6 6.7c-1.3-.1-2.4.7-3 .7s-1.5-.7-2.6-.7C12.2 9.8 11 11 11 13.2c0 2.6 1.9 5.5 3.2 5.5.6 0 1-.4 1.9-.4s1.2.4 1.9.4c1.3 0 2.9-2.6 3-4-1.4-.6-1.6-2.8-.3-3.5-.4-.7-1-1-1.1-1z';
const GOOGLE_PATH =
  'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zm2 1v3h6V8H5zm8 0v3h6V8h-6zm-8 5v3h6v-3H5zm8 0v3h6v-3h-6z';

/**
 * The dark wallet pill (`.wallet`). Renders the OS-appropriate glyph and label.
 * Apple by default; Google when `os="google"`.
 */
export function WalletButton({ os = 'apple', className, type, ...rest }: WalletButtonProps) {
  const isGoogle = os === 'google';
  const cls = ['wallet', className].filter(Boolean).join(' ');
  return (
    <button className={cls} type={type ?? 'button'} {...rest}>
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={isGoogle ? GOOGLE_PATH : APPLE_PATH} />
      </svg>
      {isGoogle ? 'Save to Google Wallet' : 'Add to Apple Wallet'}
    </button>
  );
}
