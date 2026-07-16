import type { LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';

import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Optional leading icon, sized and coloured to the label. */
  icon?: LucideIcon;
}

/**
 * Full-pill action button: royal `primary`, outlined `secondary`, and a soft-red
 * `destructive` (the modal's "Cancel session"). Renders a native <button>.
 */
export function Button({ variant = 'primary', icon: Icon, children, className, ...rest }: ButtonProps) {
  return (
    <button
      className={[styles.button, styles[variant], className ?? ''].join(' ').trim()}
      {...rest}
    >
      {Icon ? <Icon size={16} strokeWidth={2.25} aria-hidden /> : null}
      {children}
    </button>
  );
}
