'use client';

import { centsToDecimalString, eurosToCents } from '@batimint/domain';
import { TextField } from '@batimint/ui';
import { useEffect, useState } from 'react';

/** Saisie d'un montant en euros (virgule ou point), stocké en centimes. */
export function MoneyInput({
  label,
  cents,
  onChange,
  hint,
  className,
  hideLabel,
}: {
  label: string;
  cents: number;
  onChange: (cents: number) => void;
  hint?: string;
  className?: string;
  hideLabel?: boolean;
}) {
  const [text, setText] = useState(() => centsToDecimalString(BigInt(cents)).replace('.', ','));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const current = (() => {
      try {
        return Number(eurosToCents(text));
      } catch {
        return null;
      }
    })();
    if (current !== cents) setText(centsToDecimalString(BigInt(cents)).replace('.', ','));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cents]);
  return (
    <TextField
      label={label}
      containerClassName={className}
      className={hideLabel ? 'text-right' : undefined}
      inputMode="decimal"
      value={text}
      hint={hint}
      error={error}
      trailing={<span className="pr-2 text-[14px] text-muted">€</span>}
      onChange={(e) => {
        setText(e.target.value);
        try {
          onChange(Number(eurosToCents(e.target.value || '0')));
          setError(null);
        } catch {
          setError('Montant invalide');
        }
      }}
    />
  );
}
