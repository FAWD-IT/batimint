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
    <div className="sticky bottom-4 z-20 mx-auto flex w-full max-w-3xl items-center justify-between gap-3 rounded-[16px] bg-panel px-4 py-3 text-white">
      <span className="text-[14px] font-medium">{t('unsavedChanges')}</span>
      <div className="flex gap-2">
        <Button variant="ghost" className="text-white hover:bg-white/10" onClick={onDiscard}>
          {t('discard')}
        </Button>
        <Button variant="inverse" onClick={onSave} loading={saving} loadingLabel={t('saving')}>
          {t('save')}
        </Button>
      </div>
    </div>
  );
}
