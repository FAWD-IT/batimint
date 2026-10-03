'use client';

import type { SupplierInvoiceDto, SupplierInvoiceSummaryDto } from '@batimint/contracts';
import { formatEuros } from '@batimint/domain';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  PageHeader,
  Segmented,
  Skeleton,
  Table,
  Td,
  Th,
  useToast,
} from '@batimint/ui';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Inbox, Upload } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { useApi } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { uploadRaw } from '@/lib/upload';
import { useErrorMessage } from '@/lib/use-error-message';
import { useRelativeTime } from '@/lib/use-relative-time';
import { InvoiceDrawer } from './InvoiceDrawer';
import { PurchasingNav } from './PurchasingNav';
import { INVOICE_STATUS_TONES } from './status';
import { ExportButtons } from '@/components/ExportButtons';

type View = 'inbox' | 'allocated' | 'to_pay' | 'all';
const VIEWS: View[] = ['inbox', 'allocated', 'to_pay', 'all'];

interface ListResponse {
  items: SupplierInvoiceSummaryDto[];
  counts: { inbox: number; allocated: number; to_pay: number };
}

/** Factures fournisseurs : boîte « À imputer », imputées, à payer (02 P6). */
export function InvoicesView() {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const can = useCan();
  const errorMessage = useErrorMessage();
  const relative = useRelativeTime();
  const toast = useToast();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const view = (VIEWS as string[]).includes(search.get('vue') ?? '') ? (search.get('vue') as View) : 'inbox';
  const openId = search.get('facture');
  const list = useApi<ListResponse>(
    ['supplier_invoices', 'list', view],
    can('supplier_invoices.read') ? `/supplier-invoices?view=${view}` : null,
  );

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const dto = await uploadRaw<SupplierInvoiceDto>(`/supplier-invoices/upload?id=${uuidv7()}`, file, {
        fileName: file.name,
      });
      toast.show({ title: t('upload.done'), description: t('upload.reading'), tone: 'good' });
      void queryClient.invalidateQueries({ queryKey: ['supplier_invoices'] });
      setParams({ facture: dto.id, vue: 'inbox' });
    } catch (err) {
      toast.show({ title: t('upload.failed'), description: errorMessage(err), tone: 'crit' });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  if (!can('supplier_invoices.read'))
    return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;
  const items = list.data?.items ?? [];
  const counts = list.data?.counts;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title={t('title')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportButtons list="supplier-invoices" />
            {can('supplier_invoices.allocate') ? (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  accept="application/pdf,image/*,.xml,application/xml,text/xml"
                  onChange={(e) => void onFile(e.target.files?.[0])}
                />
                <Button
                  icon={<Upload aria-hidden className="size-4" />}
                  loading={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  {t('upload.button')}
                </Button>
              </>
            ) : null}
          </div>
        }
      />
      <PurchasingNav inboxCount={counts?.inbox} />
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <Segmented<View>
          label={tc('filter')}
          value={view}
          onChange={(v) => setParams({ vue: v === 'inbox' ? null : v })}
          options={VIEWS.map((v) => ({
            value: v,
            label: v !== 'all' && counts ? `${t(`views.${v}`)} (${counts[v]})` : t(`views.${v}`),
          }))}
        />
      </div>
      {list.error ? (
        <ErrorState
          title={tc('errorTitle')}
          description={errorMessage(list.error)}
          action={<Button onClick={() => void list.refetch()}>{tc('retry')}</Button>}
        />
      ) : list.isLoading ? (
        <Skeleton className="h-72" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Inbox aria-hidden className="size-5" />}
          title={t(`empty.${view}.title`)}
          description={t(`empty.${view}.description`)}
          action={
            view === 'inbox' && can('supplier_invoices.allocate') ? (
              <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                {t('upload.button')}
              </Button>
            ) : null
          }
        />
      ) : (
        <Table label={t(`views.${view}`)}>
          <thead>
            <tr>
              <Th>{t('columns.supplier')}</Th>
              <Th className="hidden md:table-cell">{t('columns.project')}</Th>
              <Th align="right">{t('columns.net')}</Th>
              <Th align="right">{tc('status')}</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((x) => {
              const top = x.suggestions[0];
              const target = x.allocatedProjects.length
                ? x.allocatedProjects.join(', ')
                : top
                  ? t('suggested', { project: top.projectLabel })
                  : '—';
              return (
                <tr key={x.id} className="hover:bg-line-soft/40">
                  <Td>
                    <button
                      type="button"
                      onClick={() => setParams({ facture: x.id })}
                      className="flex min-h-11 w-full flex-col justify-center rounded-[8px] text-left focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      <span className="font-medium hover:underline">{x.supplier.name}</span>
                      <span className="text-[12px] text-muted">
                        {x.number ? <span className="font-mono">{x.number}</span> : t('noNumber')}
                        {' · '}
                        {t(`source.${x.source}`)} · {relative(x.receivedAt)}
                      </span>
                      <span className="text-[12px] text-muted md:hidden">{target}</span>
                    </button>
                  </Td>
                  <Td className="hidden md:table-cell">
                    <span className="block text-[14px]">{target}</span>
                    {x.discrepancies.length ? (
                      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-warn">
                        <AlertTriangle aria-hidden className="size-3.5" />
                        {t('discrepancies', { n: x.discrepancies.length })}
                      </span>
                    ) : null}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {formatEuros(BigInt(x.totalNet))}
                  </Td>
                  <Td align="right">
                    <Chip tone={INVOICE_STATUS_TONES[x.status] ?? 'neutral'} dot>
                      {t(`invoice.status.${x.status}`)}
                    </Chip>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {openId ? <InvoiceDrawer id={openId} onClose={() => setParams({ facture: null })} /> : null}
    </div>
  );
}
