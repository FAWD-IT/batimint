'use client';

import { TextField, type TextFieldProps } from '@batimint/ui';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { forwardRef, useState } from 'react';

export const PasswordField = forwardRef<HTMLInputElement, Omit<TextFieldProps, 'type' | 'trailing'>>(function PasswordField(props, ref) {
  const t = useTranslations('auth');
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      ref={ref}
      type={visible ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t('hidePassword') : t('showPassword')}
          aria-pressed={visible}
          className="flex size-9 items-center justify-center rounded-[8px] text-muted hover:bg-line-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
        >
          {visible ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
        </button>
      }
      {...props}
    />
  );
});
