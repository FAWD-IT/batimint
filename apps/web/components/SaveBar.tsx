'use client';

import { Button } from '@batimint/ui';
import { useTranslations } from 'next-intl';

/** Barre d'enregistrement collante, visible dès qu'il y a des modifications. */
export function SaveBar({
  dirty,
  saving,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const t = useTranslations('common');
  if (!dirty) return null;
  return (
    <div className="sticky bottom-4 z-20 mx-auto flex w-full max-w-3xl items-center justify-between gap-3 rounded-[16px] bg-panel px-3 py-3 text-white sm:px-4">
      <span className="hidden text-[14px] font-medium sm:inline">{t('unsavedChanges')}</span>
      <div className="flex flex-1 justify-end gap-2 sm:flex-none">
        <Button
          variant="ghost"
          className="flex-1 text-white hover:bg-white/10 sm:flex-none"
          onClick={onDiscard}
        >
          <span className="sm:hidden">{t('cancel')}</span>
          <span className="hidden sm:inline">{t('discard')}</span>
        </Button>
        <Button
          variant="inverse"
          className="flex-1 sm:flex-none"
          onClick={onSave}
          loading={saving}
          loadingLabel={t('saving')}
        >
          {t('save')}
        </Button>
      </div>
    </div>
  );
}
