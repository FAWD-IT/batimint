'use client';

import type { CompanyDto } from '@batimint/contracts';
import {
  Button,
  buttonClasses,
  Card,
  CardTitle,
  ErrorState,
  PageHeader,
  Skeleton,
  useToast,
} from '@batimint/ui';
import { Copy, ExternalLink, Mail } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';
import { useApi } from '@/lib/hooks';
import { useCan } from '@/lib/session';

const noopSubscribe = () => () => undefined;

/** Paramètres → Formulaire web : lien direct, code d'intégration et adresse de réception. */
export function WebFormSettings() {
  const t = useTranslations('webform');
  const ts = useTranslations('settings');
  const tc = useTranslations('common');
  const can = useCan();
  const toast = useToast();
  const company = useApi<CompanyDto>(['company'], can('company.read') ? '/company' : null);
  const origin = useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => '',
  );

  if (!can('company.read'))
    return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;
  if (!company.data) return <Skeleton className="mx-auto h-96 max-w-3xl" />;

  const url = `${origin}/f/${company.data.slug}`;
  const snippet = `<iframe src="${url}?embed=1" title="${t('public.title')}" data-batimint-form style="width:100%;min-height:760px;border:0"></iframe>\n<script src="${origin}/embed.js" async></script>`;
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show({ title: tc('copied'), tone: 'good' });
    } catch {
      toast.show({ title: tc('errorTitle'), tone: 'crit' });
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader
        breadcrumb={
          <Link href="/parametres" className="hover:underline">
            {ts('title')}
          </Link>
        }
        title={t('title')}
        description={t('description')}
      />
      <Card className="flex flex-col gap-3">
        <CardTitle>{t('link')}</CardTitle>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <code
            className="min-w-0 flex-1 truncate rounded-[10px] bg-line-soft px-3 py-2.5 text-[14px]"
            data-testid="webform-url"
          >
            {url}
          </code>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              icon={<Copy aria-hidden className="size-4" />}
              onClick={() => void copy(url)}
            >
              {tc('copy')}
            </Button>
            <a href={url} target="_blank" rel="noreferrer" className={buttonClasses('ghost')}>
              <ExternalLink aria-hidden className="size-4" />
              {t('open')}
            </a>
          </div>
        </div>
      </Card>
      <Card className="flex flex-col gap-3">
        <CardTitle>{t('embed')}</CardTitle>
        <p className="text-[14px] text-muted">{t('embedHint')}</p>
        <pre className="overflow-x-auto rounded-[12px] bg-panel p-4 text-[13px] leading-relaxed whitespace-pre-wrap text-white">
          <code>{snippet}</code>
        </pre>
        <Button
          variant="secondary"
          className="self-start"
          icon={<Copy aria-hidden className="size-4" />}
          onClick={() => void copy(snippet)}
        >
          {tc('copy')}
        </Button>
      </Card>
      <Card className="flex flex-col gap-2">
        <CardTitle>{t('inboundTitle')}</CardTitle>
        {company.data.inboundEmail ? (
          <>
            <p className="text-[14px] text-muted">{t('inboundHint')}</p>
            <p className="flex items-center gap-2 font-medium">
              <Mail aria-hidden className="size-4" />
              {company.data.inboundEmail}
            </p>
          </>
        ) : (
          <p className="text-[14px] text-muted">{t('inboundUnavailable')}</p>
        )}
      </Card>
      {origin ? (
        <section className="flex flex-col gap-2" aria-label={t('preview')}>
          <h2 className="text-[15px] font-semibold">{t('preview')}</h2>
          <iframe
            src={`${url}?embed=1&preview=1`}
            title={t('preview')}
            className="h-[760px] w-full rounded-[16px] border border-line bg-surface"
          />
        </section>
      ) : null}
    </div>
  );
}
