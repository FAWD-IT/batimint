'use client';

import type { AttachmentDto } from '@batimint/contracts';
import { Card, CardTitle, Skeleton } from '@batimint/ui';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/hooks';
import type { Visit } from '@/components/visit/VisitEditor';

/** Notes, mesures et photos de la visite technique, à côté du devis (P2.3). */
export function VisitPanel({ opportunityId }: { opportunityId: string }) {
  const t = useTranslations('quotes.visit');
  const detail = useApi<{ visits: Visit[] }>(
    ['opportunities', opportunityId],
    `/opportunities/${opportunityId}`,
  );
  const media = useApi<{ items: AttachmentDto[] }>(
    ['attachments', 'opportunity', opportunityId],
    `/attachments?ownerType=opportunity&ownerId=${opportunityId}`,
  );
  const visit = detail.data?.visits.at(-1);
  const photos = (media.data?.items ?? []).filter((a) => a.kind === 'photo');
  const voices = (media.data?.items ?? []).filter((a) => a.kind === 'voice_note' && a.transcript);
  return (
    <Card className="flex flex-col gap-3 p-4 md:p-5" role="region" aria-label={t('title')}>
      <div className="flex items-center justify-between gap-2">
        <CardTitle as="h2">{t('title')}</CardTitle>
        <Link
          href={`/opportunites/${opportunityId}`}
          className="text-[13px] font-medium underline-offset-2 hover:underline"
        >
          {t('open')}
        </Link>
      </div>
      {detail.isLoading ? (
        <Skeleton className="h-24" />
      ) : !visit ? (
        <p className="text-[14px] text-muted">{t('none')}</p>
      ) : (
        <>
          {visit.measurements.length ? (
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[13px]">
              {visit.measurements.map((m, i) => (
                <div key={i} className="contents">
                  <dt className="text-muted">{m.label}</dt>
                  <dd className="text-right font-medium tabular-nums">
                    {m.value} {m.unit}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {visit.notes ? <p className="text-[13px] whitespace-pre-line">{visit.notes}</p> : null}
        </>
      )}
      {voices.map((v) => (
        <blockquote key={v.id} className="border-l-2 border-accent pl-3 text-[13px] text-muted">
          {v.transcript}
        </blockquote>
      ))}
      {photos.length ? (
        <ul className="grid grid-cols-3 gap-1.5" aria-label={t('photos')}>
          {photos.slice(0, 9).map((p) => (
            <li key={p.id}>
              <a
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="block aspect-square overflow-hidden rounded-[8px] bg-line-soft"
              >
                <img src={p.url} alt="" loading="lazy" className="size-full object-cover" />
                <span className="sr-only">{p.fileName}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
