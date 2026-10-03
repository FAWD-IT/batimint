'use client';

import type { SubcontractorDocumentKind } from '@batimint/contracts';
import { Button, Dialog, SelectField, TextField } from '@batimint/ui';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { uploadRaw } from '@/lib/upload';
import { useErrorMessage } from '@/lib/use-error-message';

export const DOCUMENT_KINDS: SubcontractorDocumentKind[] = [
  'rc_insurance',
  'social_certificate',
  'tax_certificate',
  'access_certificate',
  'other',
];

const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Dépôt d'un document de sous-traitant (bureau ou portail) : type, échéance et fichier. Le chemin
 * d'envoi est fourni par l'appelant (`/subcontractors/:id/documents` ou le portail).
 */
export function DocumentUploadDialog({
  path,
  kind: initialKind,
  vouvoiement,
  onClose,
  onUploaded,
}: {
  path: string;
  kind?: SubcontractorDocumentKind;
  /** Portail sous-traitant : textes vouvoyés. */
  vouvoiement?: boolean;
  onClose: () => void;
  onUploaded: (result: unknown) => void;
}) {
  const t = useTranslations('subcontracting.documents');
  const tk = useTranslations('subcontracting.documentKinds');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const fileId = useId();
  const [id] = useState(() => uuidv7());
  const [kind, setKind] = useState<SubcontractorDocumentKind>(initialKind ?? 'rc_insurance');
  const [expiresOn, setExpiresOn] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsExpiry = kind !== 'other' && kind !== 'access_certificate';

  const submit = async () => {
    if (!file) return setError(t('errors.file'));
    if (file.size > MAX_BYTES) return setError(t('errors.tooLarge'));
    if (needsExpiry && !expiresOn) return setError(t('errors.expiry'));
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ id, kind, ...(expiresOn ? { expiresOn } : {}) });
      const result = await uploadRaw(`${path}?${qs.toString()}`, file, { fileName: file.name });
      onUploaded(result);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={vouvoiement ? t('portalTitle') : t('uploadTitle')}
      description={vouvoiement ? t('portalDescription') : t('uploadDescription')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            {t('send')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <SelectField
          label={t('kind')}
          value={kind}
          onChange={(e) => setKind(e.target.value as SubcontractorDocumentKind)}
          options={DOCUMENT_KINDS.map((k) => ({ value: k, label: tk(k) }))}
        />
        <TextField
          label={t('expiresOn')}
          type="date"
          value={expiresOn}
          hint={needsExpiry ? t('expiresOnHint') : undefined}
          optionalLabel={needsExpiry ? undefined : tc('optional')}
          onChange={(e) => setExpiresOn(e.target.value)}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={fileId} className="text-[13px] font-semibold">
            {t('file')}
          </label>
          <input
            id={fileId}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="min-h-11 rounded-[10px] border border-line bg-surface px-3 py-2 text-[14px] file:mr-3 file:rounded-[8px] file:border-0 file:bg-line-soft file:px-3 file:py-1.5 file:font-medium focus-visible:outline-2 focus-visible:outline-accent"
          />
          <p className="text-[13px] text-muted">{t('fileHint')}</p>
        </div>
        {error ? (
          <p role="alert" className="text-[14px] text-crit">
            {error}
          </p>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
