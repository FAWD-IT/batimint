import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react';
import { cn } from './cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'danger' | 'ghost' | 'inverse';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-ink-inverse hover:bg-ink/90 border border-ink',
  secondary: 'bg-surface text-ink border border-line hover:border-ink/40',
  accent: 'bg-accent text-white border border-accent hover:bg-accent/90',
  danger: 'bg-crit text-white border border-crit hover:bg-crit/90',
  ghost: 'bg-transparent text-ink border border-transparent hover:bg-line-soft',
  inverse: 'bg-white text-[#111111] border border-white hover:bg-white/90',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-[13px] rounded-[10px] gap-1.5',
  md: 'h-11 px-4 text-[15px] rounded-[12px] gap-2',
  lg: 'h-14 px-5 text-[16px] rounded-[14px] gap-2.5',
  xl: 'h-[88px] px-6 text-[20px] rounded-[20px] gap-3',
};

export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string): string {
  return cn(
    'inline-flex select-none items-center justify-center font-semibold whitespace-nowrap',
    'transition-[background-color,border-color,opacity] duration-[120ms] ease-out',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    'disabled:pointer-events-none disabled:opacity-50',
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Texte lu par les lecteurs d'écran pendant le chargement. */
  loadingLabel?: string;
  icon?: ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, loadingLabel, icon, fullWidth, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, cn(fullWidth && 'w-full', className))}
      {...rest}
    >
      {loading ? <Spinner label={loadingLabel} /> : icon}
      {children}
    </button>
  );
});
