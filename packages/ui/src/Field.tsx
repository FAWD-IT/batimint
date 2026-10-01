import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, useId } from 'react';
import { cn } from './cn';

const CONTROL =
  'w-full rounded-[10px] border border-line bg-surface px-3 text-[15px] text-ink placeholder:text-muted ' +
  'transition-[border-color] duration-[120ms] hover:border-ink/30 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent focus-visible:border-accent ' +
  'aria-[invalid=true]:border-crit disabled:opacity-60';

interface FieldShellProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  /** Mention affichée à côté d'un champ facultatif. */
  optionalLabel?: string;
  className?: string;
  id: string;
  children: ReactNode;
}

function FieldShell({ label, hint, error, optionalLabel, className, id, children }: FieldShellProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-semibold text-ink">
        {label}
        {optionalLabel ? <span className="ml-1 font-normal text-muted">{optionalLabel}</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[13px] text-crit">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  optionalLabel?: string;
  containerClassName?: string;
  trailing?: ReactNode;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, optionalLabel, containerClassName, className, id, trailing, ...rest },
  ref,
) {
  const auto = useId();
  const fieldId = id ?? auto;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  return (
    <FieldShell label={label} hint={hint} error={error} optionalLabel={optionalLabel} className={containerClassName} id={fieldId}>
      <div className="relative">
        <input
          ref={ref}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(CONTROL, 'h-11', trailing ? 'pr-11' : undefined, className)}
          {...rest}
        />
        {trailing ? <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div> : null}
      </div>
    </FieldShell>
  );
});

export interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  optionalLabel?: string;
  containerClassName?: string;
}

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(function TextAreaField(
  { label, hint, error, optionalLabel, containerClassName, className, id, ...rest },
  ref,
) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldShell label={label} hint={hint} error={error} optionalLabel={optionalLabel} className={containerClassName} id={fieldId}>
      <textarea
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        className={cn(CONTROL, 'min-h-24 py-2.5', className)}
        {...rest}
      />
    </FieldShell>
  );
});

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  containerClassName?: string;
  options: { value: string; label: string }[];
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hint, error, containerClassName, className, id, options, ...rest },
  ref,
) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldShell label={label} hint={hint} error={error} className={containerClassName} id={fieldId}>
      <select
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        className={cn(CONTROL, 'h-11 appearance-none bg-[length:16px] pr-9', className)}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
});

export function Checkbox({ label, id, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <label htmlFor={fieldId} className={cn('flex min-h-11 cursor-pointer items-center gap-3 text-[14px]', className)}>
      <input id={fieldId} type="checkbox" className="size-5 accent-[var(--ink)]" {...rest} />
      <span>{label}</span>
    </label>
  );
}
