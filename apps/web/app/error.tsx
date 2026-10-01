'use client';

import { Button, ErrorState } from '@batimint/ui';
import { useTranslations } from 'next-intl';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('common');
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg items-center px-4">
      <ErrorState title={t('errorTitle')} description={t('unexpectedError')} action={<Button onClick={reset}>{t('retry')}</Button>} />
    </main>
  );
}
