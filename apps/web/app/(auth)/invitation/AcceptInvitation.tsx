'use client';

import { buttonClasses, Button, Notice, Skeleton, TextField } from '@batimint/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { AuthCard } from '@/components/AuthCard';
import { PasswordField } from '@/components/PasswordField';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/use-error-message';

interface Lookup {
  tenantName: string;
  email: string;
  role: string;
  inviterName: string | null;
  accountExists: boolean;
}

/** 02 P1.6 — l'invité crée son accès (ou relie son compte existant) et arrive directement dans l'entreprise. */
export function AcceptInvitation() {
  const t = useTranslations('invitation');
  const ta = useTranslations('auth');
  const tr = useTranslations('roles');
  const router = useRouter();
  const token = useSearchParams().get('token');
  const errorMessage = useErrorMessage();
  const lookup = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api<Lookup>(`/invitations/lookup?token=${encodeURIComponent(token!)}`),
    enabled: Boolean(token),
    retry: false,
  });
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!token || lookup.error) {
    return (
      <AuthCard title={t('invalid')}>
        <Notice tone="crit">{token ? errorMessage(lookup.error) : ta('missingToken')}</Notice>
        <Link href="/connexion" className={buttonClasses('primary', 'lg', 'w-full')}>
          {ta('backToLogin')}
        </Link>
      </AuthCard>
    );
  }
  if (!lookup.data) {
    return (
      <AuthCard title="…">
        <Skeleton className="h-40" />
      </AuthCard>
    );
  }
  const inv = lookup.data;
  const role = tr(inv.role as 'owner');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!inv.accountExists && name.trim().length < 2) errs['name'] = ta('validation.name');
    if (inv.accountExists ? !password : password.length < 10)
      errs['password'] = inv.accountExists ? ta('validation.required') : ta('validation.password');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setPending(true);
    setFormError(null);
    try {
      await api('/invitations/accept', {
        body: { token, ...(inv.accountExists ? {} : { name: name.trim() }), password },
        idempotencyKey: false,
      });
      router.replace('/aujourdhui');
      router.refresh();
    } catch (err) {
      setFormError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <AuthCard
      title={t('title', { tenant: inv.tenantName })}
      subtitle={
        inv.inviterName ? t('subtitle', { inviter: inv.inviterName, role }) : t('subtitleNoInviter', { role })
      }
    >
      <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <p className="text-[14px]">
          {inv.accountExists
            ? t('existingAccount', { email: inv.email })
            : t('createAccount', { email: inv.email })}
        </p>
        {formError ? <Notice tone="crit">{formError}</Notice> : null}
        {!inv.accountExists ? (
          <TextField
            label={t('name')}
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors['name']}
            autoFocus
          />
        ) : null}
        <PasswordField
          label={inv.accountExists ? t('password') : t('choosePassword')}
          autoComplete={inv.accountExists ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={inv.accountExists ? undefined : ta('passwordHint')}
          error={errors['password']}
        />
        <Button type="submit" size="lg" fullWidth loading={pending}>
          {t('accept')}
        </Button>
      </form>
    </AuthCard>
  );
}
