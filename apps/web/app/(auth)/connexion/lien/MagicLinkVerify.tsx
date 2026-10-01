'use client';

import { buttonClasses, Notice, Spinner } from '@batimint/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { AuthCard } from '@/components/AuthCard';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/use-error-message';

export function MagicLinkVerify() {
  const t = useTranslations('auth');
  const router = useRouter();
  const params = useSearchParams();
  const errorMessage = useErrorMessage();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = params.get('token');
    if (!token) {
      setError(t('missingToken'));
      return;
    }
    api('/auth/magic-link/verify', { body: { token }, idempotencyKey: false })
      .then(() => {
        router.replace('/aujourdhui');
        router.refresh();
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [params, router, t, errorMessage]);

  if (error) {
    return (
      <AuthCard title={t('magicFailedTitle')}>
        <Notice tone="crit">{error}</Notice>
        <Link href="/connexion" className={buttonClasses('primary', 'lg', 'w-full')}>
          {t('backToLogin')}
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={t('loginTitle')}>
      <p className="flex items-center gap-3 text-[15px]" role="status">
        <Spinner /> {t('magicVerifying')}
      </p>
    </AuthCard>
  );
}
