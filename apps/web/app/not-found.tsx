import { buttonClasses, EmptyState } from '@batimint/ui';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export default async function NotFound() {
  const t = await getTranslations('common');
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg items-center px-4">
      <EmptyState
        className="w-full"
        title={t('notFoundTitle')}
        description={t('notFoundDescription')}
        action={
          <Link href="/" className={buttonClasses('primary')}>
            {t('goHome')}
          </Link>
        }
      />
    </main>
  );
}
