'use client';

import { centsToDecimalString, eurosToCents } from '@batimint/domain';
import { cn } from '@batimint/ui';
import { type InputHTMLAttributes, type TextareaHTMLAttributes, useEffect, useRef, useState } from 'react';

const CELL =
  'h-10 w-full min-w-0 rounded-[8px] border border-transparent bg-transparent px-2 text-[14px] text-ink ' +
  'hover:border-line focus-visible:border-accent focus-visible:bg-surface focus-visible:outline-none ' +
  'disabled:hover:border-transparent aria-[invalid=true]:border-crit';

export function CellInput({
  label,
  className,
  invalid,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; invalid?: boolean }) {
  return (
    <input aria-label={label} aria-invalid={invalid || undefined} className={cn(CELL, className)} {...rest} />
  );
}

/** Zone de texte qui grandit avec son contenu (désignation de ligne). */
export function CellTextarea({
  label,
  className,
  value,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(40, el.scrollHeight)}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      aria-label={label}
      rows={1}
      value={value}
      className={cn(CELL, 'resize-none py-2 leading-snug', className)}
      {...rest}
    />
  );
}

/** Montant en euros (virgule ou point), stocké en centimes ; valide à la sortie du champ. */
export function MoneyCell({
  label,
  cents,
  onChange,
  disabled,
  className,
}: {
  label: string;
  cents: number;
  onChange: (cents: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  const format = (c: number) => centsToDecimalString(BigInt(c)).replace('.', ',');
  const [text, setText] = useState(() => format(cents));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(format(cents));
  }, [cents]);
  return (
    <CellInput
      label={label}
      inputMode="decimal"
      value={text}
      disabled={disabled}
      invalid={invalid}
      className={cn('text-right tabular-nums', className)}
      onFocus={(e) => {
        focused.current = true;
        e.currentTarget.select();
      }}
      onChange={(e) => {
        setText(e.target.value);
        try {
          onChange(Number(eurosToCents(e.target.value.replace(/\s/g, '').replace(',', '.') || '0')));
          setInvalid(false);
        } catch {
          setInvalid(true);
        }
      }}
      onBlur={() => {
        focused.current = false;
        if (!invalid) setText(format(cents));
      }}
    />
  );
}
