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
