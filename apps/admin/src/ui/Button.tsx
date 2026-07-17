import type { LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';

import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive';
export type ButtonSize = 'md' | 'sm';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** `sm` for inline/row actions (the roster's Book); `md` (default) for CTAs. */
  size?: ButtonSize;
  /** Optional leading icon, sized and coloured to the label. */
  icon?: LucideIcon;
}

/**
 * Full-pill action button: royal `primary`, outlined `secondary`, and a soft-red
 * `destructive` (the modal's "Cancel session"). Inline (content-width); renders a
 * native <button>.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  children,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={[styles.button, styles[variant], size === 'sm' ? styles.sm : '', className ?? '']
        .join(' ')
        .trim()}
      {...rest}
    >
      {Icon ? <Icon size={size === 'sm' ? 14 : 16} strokeWidth={2.25} aria-hidden /> : null}
      {children}
    </button>
  );
}
