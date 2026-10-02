'use client';

import { Button, Dialog, Notice, TextField } from '@batimint/ui';
import { CalendarPlus, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useErrorMessage } from '@/lib/use-error-message';

/**
 * Abonnement iCal (03 §6) : un lien secret à coller dans Google Agenda, Outlook ou le calendrier
 * du téléphone. Le recréer révoque l'ancien.
 */
export function CalendarLinkButton({
  employeeId,
  familiar = false,
  variant = 'secondary',
  size = 'md',
}: {
  employeeId?: string;
  familiar?: boolean;
  variant?: 'secondary' | 'ghost' | 'primary';
  size?: 'sm' | 'md' | 'lg';
}) {
  const tVous = useTranslations('planning.ical');
  const tTu = useTranslations('planning.icalTu');
  const t = familiar ? tTu : tVous;
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  const create = async () => {
    setPending(true);
    setError(null);
    try {
      const r = await api<{ url: string }>('/planning/calendar-feeds', {
        body: employeeId ? { employeeId } : {},
      });
      setUrl(r.url);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        icon={<CalendarPlus aria-hidden className="size-4" />}
        onClick={() => {
          setOpen(true);
          setUrl(null);
          void create();
        }}
      >
        {t('button')}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('title')}
        description={t('description')}
        closeLabel={tc('close')}
      >
        <div className="flex flex-col gap-3">
          {error ? <Notice tone="crit">{error}</Notice> : null}
          {url ? (
            <>
              <TextField label={t('link')} value={url} readOnly onFocus={(e) => e.currentTarget.select()} />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  icon={<Copy aria-hidden className="size-4" />}
                  onClick={() => {
                    void navigator.clipboard?.writeText(url).then(() => setCopied(true));
                  }}
                >
                  {copied ? tc('copied') : tc('copy')}
                </Button>
                <a
                  href={url.replace(/^https?:/, 'webcal:')}
                  className="inline-flex h-11 items-center rounded-[12px] border border-line px-4 text-[15px] font-semibold focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {t('open')}
                </a>
              </div>
              <p className="text-[12px] text-muted">{t('secret')}</p>
            </>
          ) : !error ? (
            <p className="text-[14px] text-muted" aria-busy={pending}>
              {tc('loading')}
            </p>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}
