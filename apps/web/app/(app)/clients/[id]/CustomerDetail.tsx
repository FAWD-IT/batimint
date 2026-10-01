'use client';

import type { CustomerDto, OpportunityDto } from '@batimint/contracts';
import { dwellingAge, formatEuros } from '@batimint/domain';
import {
  Button,
  Card,
  CardTitle,
  Chip,
  ConfirmDialog,
  Dialog,
  ErrorState,
  Overline,
  PageHeader,
  Skeleton,
} from '@batimint/ui';
import {
  Archive,
  Briefcase,
  ClipboardCheck,
  GitMerge,
  Inbox,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useState } from 'react';
import {
  ContactDialog,
  type ContactRow,
  SiteDialog,
  type SiteRow,
} from '@/components/crm/ContactSiteDialogs';
import { CustomerDialog } from '@/components/crm/CustomerDialog';
import { CustomerPicker } from '@/components/crm/CustomerPicker';
import { OpportunityDialog } from '@/components/crm/OpportunityDialog';
import { STAGE_TONES } from '@/components/crm/stages';
import { ApiError } from '@/lib/api';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { useRelativeTime } from '@/lib/use-relative-time';

interface Detail {
  customer: CustomerDto;
  contacts: ContactRow[];
  sites: SiteRow[];
}

interface TimelineItem {
  type: 'lead' | 'opportunity' | 'visit' | 'note' | 'quote' | 'project' | 'invoice';
  id: string;
  title: string;
  detail: string | null;
  at: string;
  href: string | null;
}

const TIMELINE_ICONS: Record<TimelineItem['type'], typeof Inbox> = {
  lead: Inbox,
  opportunity: Briefcase,
  visit: ClipboardCheck,
  note: Pencil,
  quote: Briefcase,
  project: Briefcase,
  invoice: Briefcase,
};

const SOURCES = new Set(['web_form', 'email', 'phone', 'manual', 'recommendation', 'merge']);

export function CustomerDetail({ id }: { id: string }) {
  const t = useTranslations('customers');
  const tp = useTranslations('pipeline');
  const tc = useTranslations('common');
  const can = useCan();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const relative = useRelativeTime();
  const detail = useApi<Detail>(['customers', id], `/customers/${id}`);
  const history = useApi<{ items: TimelineItem[] }>(['customers', id, 'history'], `/customers/${id}/history`);
  const opps = useApi<{ items: OpportunityDto[] }>(
    ['opportunities', 'customer', id],
    can('leads.read') ? `/opportunities?customerId=${id}` : null,
  );
  const [dialog, setDialog] = useState<
    | { kind: 'edit' }
    | { kind: 'contact'; contact: ContactRow | null }
    | { kind: 'site'; site: SiteRow | null }
    | { kind: 'opportunity' }
    | { kind: 'merge' }
    | { kind: 'archive' }
    | null
  >(null);
  const [mergeInto, setMergeInto] = useState<CustomerDto | null>(null);
  const canWrite = can('customers.write');

  const peppol = useApiMutation<void, CustomerDto>(
    () => ({ path: `/customers/${id}/peppol-check`, body: {} }),
    {
      invalidate: [['customers', id]],
    },
  );
  const merge = useApiMutation<string, CustomerDto>(
    (intoId) => ({ path: `/customers/${id}/merge`, body: { intoId } }),
    {
      invalidate: [['customers'], ['opportunities']],
      successMessage: t('merged'),
      onSuccess: (c) => router.replace(`/clients/${c.id}`),
    },
  );
  const archive = useApiMutation<void>(() => ({ path: `/customers/${id}`, method: 'DELETE' }), {
    invalidate: [['customers']],
    successMessage: t('archived'),
    onSuccess: () => router.replace('/clients'),
  });

  if (detail.error) {
    const missing = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <ErrorState
        title={missing ? t('notFound') : tc('errorTitle')}
        description={missing ? undefined : errorMessage(detail.error)}
        action={
          missing ? (
            <Link href="/clients" className="font-semibold underline">
              {tc('back')}
            </Link>
          ) : (
            <Button onClick={() => void detail.refetch()}>{tc('retry')}</Button>
          )
        }
      />
    );
  }
  if (!detail.data)
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-6" aria-busy>
        <Skeleton className="h-12 w-72" />
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );

  const { customer: c, contacts, sites } = detail.data;
  const address = [c.street, [c.postalCode, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        breadcrumb={
          <Link href="/clients" className="hover:underline">
            {t('title')}
          </Link>
        }
        title={c.displayName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Chip tone={c.status === 'customer' ? 'good' : 'accent'} dot>
              {t(`status.${c.status}`)}
            </Chip>
            <Chip>{t(`kind.${c.kind}`)}</Chip>
            {c.kind === 'company' && c.vatLiable ? <Chip>{t('b2b')}</Chip> : null}
            {c.source ? (
              <span className="text-[13px] text-muted">
                {t('sourceLabel', {
                  source: SOURCES.has(c.source) ? t(`sources.${c.source}`) : c.source,
                })}
              </span>
            ) : null}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {can('leads.write') ? (
              <Button
                icon={<Plus aria-hidden className="size-4" />}
                onClick={() => setDialog({ kind: 'opportunity' })}
              >
                {t('newOpportunity')}
              </Button>
            ) : null}
            {canWrite ? (
              <Button
                variant="secondary"
                icon={<Pencil aria-hidden className="size-4" />}
                onClick={() => setDialog({ kind: 'edit' })}
              >
                {tc('edit')}
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardTitle>{t('details')}</CardTitle>
            <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Info label={tc('email')} icon={<Mail aria-hidden className="size-4" />}>
                {c.email ? (
                  <a href={`mailto:${c.email}`} className="break-all underline-offset-2 hover:underline">
                    {c.email}
                  </a>
                ) : null}
              </Info>
              <Info label={tc('phone')} icon={<Phone aria-hidden className="size-4" />}>
                {c.phone ? (
                  <a href={`tel:${c.phone.replace(/\s/g, '')}`} className="tabular-nums hover:underline">
                    {c.phone}
                  </a>
                ) : null}
              </Info>
              <Info label={t('billingAddress')} icon={<MapPin aria-hidden className="size-4" />}>
                {address || null}
              </Info>
              {c.kind === 'company' ? (
                <Info label={t('enterpriseNumber')}>
                  {c.enterpriseNumber ? (
                    <span className="tabular-nums">
                      {c.enterpriseNumber}
                      {c.vatNumber ? (
                        <span className="block text-[13px] text-muted">{c.vatNumber}</span>
                      ) : null}
                    </span>
                  ) : null}
                </Info>
              ) : null}
              <Info label={t('paymentTerms')}>
                {c.paymentTermsDays !== null ? t('days', { count: c.paymentTermsDays }) : t('defaultTerms')}
              </Info>
              {c.notes ? (
                <div className="sm:col-span-2">
                  <dt className="text-[12px] font-semibold tracking-[0.06em] text-muted uppercase">
                    {tc('notes')}
                  </dt>
                  <dd className="mt-1 text-[14px] whitespace-pre-line">{c.notes}</dd>
                </div>
              ) : null}
            </dl>
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>{t('sites')}</CardTitle>
              {canWrite ? (
                <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'site', site: null })}>
                  {t('addSite')}
                </Button>
              ) : null}
            </div>
            {sites.length === 0 ? (
              <p className="mt-3 text-[14px] text-muted">{t('noSites')}</p>
            ) : (
              <ul className="mt-3 flex flex-col divide-y divide-line-soft">
                {sites.map((s) => {
                  const age = dwellingAge(s.firstOccupancyYear);
                  return (
                    <li key={s.id} className="flex items-start justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="font-medium">{s.label ?? s.street}</p>
                        <p className="text-[13px] text-muted">
                          {s.label ? `${s.street}, ` : ''}
                          {s.postalCode} {s.city}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {s.isPrivateDwelling ? <Chip>{t('privateDwelling')}</Chip> : null}
                          {s.isPrivateDwelling && age !== undefined ? (
                            <Chip tone={age >= 10 ? 'good' : 'neutral'}>
                              {t('dwellingAge', { years: age })}
                              {age >= 10 ? ` · ${t('sixPercent')}` : ''}
                            </Chip>
                          ) : null}
                        </div>
                        {s.accessNotes ? <p className="mt-1 text-[13px]">{s.accessNotes}</p> : null}
                      </div>
                      {canWrite ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`${tc('edit')} ${s.label ?? s.street}`}
                          onClick={() => setDialog({ kind: 'site', site: s })}
                        >
                          <Pencil aria-hidden className="size-4" />
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>{t('contacts')}</CardTitle>
              {canWrite ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setDialog({ kind: 'contact', contact: null })}
                >
                  {t('addContact')}
                </Button>
              ) : null}
            </div>
            {contacts.length === 0 ? (
              <p className="mt-3 text-[14px] text-muted">{t('noContacts')}</p>
            ) : (
              <ul className="mt-3 flex flex-col divide-y divide-line-soft">
                {contacts.map((ct) => (
                  <li key={ct.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {[ct.firstName, ct.lastName].filter(Boolean).join(' ')}
                        {ct.isPrimary ? (
                          <Chip tone="accent" className="ml-2">
                            {t('primary')}
                          </Chip>
                        ) : null}
                      </p>
                      <p className="text-[13px] text-muted">
                        {[ct.jobTitle, ct.email, ct.phone].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>
                    {canWrite ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`${tc('edit')} ${ct.lastName}`}
                        onClick={() => setDialog({ kind: 'contact', contact: ct })}
                      >
                        <Pencil aria-hidden className="size-4" />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                icon={<GitMerge aria-hidden className="size-4" />}
                onClick={() => setDialog({ kind: 'merge' })}
              >
                {t('merge')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<Archive aria-hidden className="size-4" />}
                onClick={() => setDialog({ kind: 'archive' })}
              >
                {t('archive')}
              </Button>
            </div>
          ) : null}
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          {c.kind === 'company' ? (
            <Card>
              <Overline>{t('peppol')}</Overline>
              <p className="mt-2 text-[15px] font-semibold">
                {c.peppolReachable === true
                  ? t('peppolReachable')
                  : c.peppolReachable === false
                    ? t('peppolUnreachable')
                    : t('peppolUnknown')}
              </p>
              <p className="mt-1 text-[13px] text-muted">{t('peppolHint')}</p>
              {canWrite ? (
                <Button
                  className="mt-3"
                  size="sm"
                  variant="secondary"
                  icon={<RefreshCw aria-hidden className="size-4" />}
                  loading={peppol.isPending}
                  disabled={!c.enterpriseNumber}
                  onClick={() => peppol.mutate()}
                >
                  {t('peppolCheck')}
                </Button>
              ) : null}
            </Card>
          ) : null}

          {can('leads.read') ? (
            <Card>
              <CardTitle>{t('opportunities')}</CardTitle>
              {opps.isLoading ? (
                <Skeleton className="mt-3 h-20" />
              ) : (opps.data?.items.length ?? 0) === 0 ? (
                <p className="mt-3 text-[14px] text-muted">{t('noOpportunities')}</p>
              ) : (
                <ul className="mt-3 flex flex-col gap-2">
                  {opps.data!.items.map((o) => (
                    <li key={o.id}>
                      <Link
                        href={`/opportunites/${o.id}`}
                        className="flex min-h-11 items-center justify-between gap-3 rounded-[12px] border border-line px-3 py-2 hover:border-ink/40 focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[14px] font-medium">{o.title}</span>
                          {o.estimatedAmount ? (
                            <span className="block text-[13px] text-muted tabular-nums">
                              {formatEuros(BigInt(o.estimatedAmount))}
                            </span>
                          ) : null}
                        </span>
                        <Chip tone={STAGE_TONES[o.stage]} dot>
                          {tp(`stages.${o.stage}`)}
                        </Chip>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          <Card>
            <CardTitle>{t('history')}</CardTitle>
            {history.isLoading ? (
              <Skeleton className="mt-3 h-24" />
            ) : (history.data?.items.length ?? 0) === 0 ? (
              <p className="mt-3 text-[14px] text-muted">{t('noHistory')}</p>
            ) : (
              <ol className="mt-4 flex flex-col gap-4">
                {history.data!.items.map((h) => {
                  const Icon = TIMELINE_ICONS[h.type];
                  const body = (
                    <>
                      <span className="block text-[14px] font-medium">{h.title}</span>
                      {h.detail ? (
                        <span className="line-clamp-2 block text-[13px] text-muted">{h.detail}</span>
                      ) : null}
                      <span className="block text-[12px] text-muted">{relative(h.at)}</span>
                    </>
                  );
                  return (
                    <li key={`${h.type}-${h.id}`} className="flex gap-3">
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-line-soft">
                        <Icon aria-hidden className="size-3.5" />
                      </span>
                      {h.href ? (
                        <Link href={h.href} className="min-w-0 hover:underline">
                          {body}
                        </Link>
                      ) : (
                        <span className="min-w-0">{body}</span>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </aside>
      </div>

      {dialog?.kind === 'edit' ? <CustomerDialog customer={c} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'contact' ? (
        <ContactDialog customerId={c.id} contact={dialog.contact} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'site' ? (
        <SiteDialog customerId={c.id} site={dialog.site} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'opportunity' ? (
        <OpportunityDialog
          customer={c}
          onClose={() => setDialog(null)}
          onCreated={(o) => router.push(`/opportunites/${o.id}`)}
        />
      ) : null}
      {dialog?.kind === 'merge' ? (
        <Dialog
          open
          onClose={() => {
            setDialog(null);
            setMergeInto(null);
          }}
          title={t('mergeTitle', { name: c.displayName })}
          description={t('mergeDescription')}
          closeLabel={tc('close')}
          footer={
            mergeInto ? (
              <>
                <Button variant="secondary" onClick={() => setMergeInto(null)}>
                  {tc('back')}
                </Button>
                <Button loading={merge.isPending} onClick={() => merge.mutate(mergeInto.id)}>
                  {t('mergeConfirm', { name: mergeInto.displayName })}
                </Button>
              </>
            ) : undefined
          }
        >
          {mergeInto ? (
            <p className="text-[14px]">
              {t('mergeSummary', { from: c.displayName, into: mergeInto.displayName })}
            </p>
          ) : (
            <CustomerPicker label={t('mergeInto')} onSelect={setMergeInto} excludeId={c.id} autoFocus />
          )}
        </Dialog>
      ) : null}
      <ConfirmDialog
        open={dialog?.kind === 'archive'}
        onClose={() => setDialog(null)}
        onConfirm={() => archive.mutate()}
        loading={archive.isPending}
        title={t('archiveTitle', { name: c.displayName })}
        description={t('archiveDescription')}
        confirmLabel={t('archive')}
        cancelLabel={tc('cancel')}
        closeLabel={tc('close')}
        destructive
      />
    </div>
  );
}

function Info({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[12px] font-semibold tracking-[0.06em] text-muted uppercase">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 text-[14px]">{children ?? <span className="text-muted">—</span>}</dd>
    </div>
  );
}
