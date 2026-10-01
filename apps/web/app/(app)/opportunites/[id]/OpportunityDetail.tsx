'use client';

import type { OpportunityDto } from '@batimint/contracts';
import { formatEuros, OPPORTUNITY_STAGES, type OpportunityStage } from '@batimint/domain';
import {
  Button,
  Card,
  CardTitle,
  Chip,
  Dialog,
  ErrorState,
  Notice,
  Overline,
  PageHeader,
  SelectField,
  Skeleton,
  TextAreaField,
  TextField,
  useToast,
} from '@batimint/ui';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, ClipboardCheck, FileText, MapPin, Navigation, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { MoneyInput } from '@/components/MoneyInput';
import { TRADES } from '@/components/crm/OpportunityDialog';
import { STAGE_TONES } from '@/components/crm/stages';
import { MediaPanel } from '@/components/visit/MediaPanel';
import { type Visit, VisitEditor } from '@/components/visit/VisitEditor';
import { api, ApiError } from '@/lib/api';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { LostReasonDialog } from '../LostReasonDialog';

export function OpportunityDetail({ id }: { id: string }) {
  const t = useTranslations('pipeline');
  const tv = useTranslations('visit');
  const tc = useTranslations('common');
  const can = useCan();
  const toast = useToast();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const detail = useApi<{ opportunity: OpportunityDto; visits: Visit[] }>(
    ['opportunities', id],
    `/opportunities/${id}`,
  );
  const site = useApi<{
    sites: { id: string; street: string; postalCode: string; city: string; accessNotes: string | null }[];
  }>(
    ['customers', detail.data?.opportunity.customerId, 'detail'],
    detail.data ? `/customers/${detail.data.opportunity.customerId}` : null,
  );
  const [dialog, setDialog] = useState<'edit' | 'plan' | 'lost' | null>(null);
  const canVisit = can('site_visits.write');
  const canWrite = can('leads.write');

  const startVisit = useApiMutation<Record<string, unknown>>(
    (body) => ({ path: `/opportunities/${id}/visits`, body: { id: uuidv7(), ...body } }),
    { invalidate: [['opportunities']], onSuccess: () => setDialog(null) },
  );

  const moveTo = async (stage: OpportunityStage, lostReason?: string) => {
    try {
      await api(`/opportunities/${id}/move`, {
        body: { stage, position: 0, lostReason: lostReason ?? null },
      });
      toast.show({ title: t('moved', { stage: t(`stages.${stage}`) }), tone: 'good' });
    } catch (err) {
      toast.show({ title: tc('errorTitle'), description: errorMessage(err), tone: 'crit' });
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['opportunities'] });
    }
  };

  if (detail.error) {
    const missing = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <ErrorState
        title={missing ? t('notFound') : tc('errorTitle')}
        description={missing ? undefined : errorMessage(detail.error)}
        action={
          missing ? (
            <Link href="/opportunites" className="font-semibold underline">
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
        <Skeleton className="h-12 w-80" />
        <Skeleton className="h-96" />
      </div>
    );

  const { opportunity: o, visits } = detail.data;
  const siteRow = site.data?.sites.find((s) => s.id === o.siteId);
  const mapsUrl = siteRow
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${siteRow.street}, ${siteRow.postalCode} ${siteRow.city}`)}`
    : null;
  const visit = visits.at(-1);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        breadcrumb={
          <Link href="/opportunites" className="hover:underline">
            {t('title')}
          </Link>
        }
        title={o.title}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Chip tone={STAGE_TONES[o.stage]} dot>
              {t(`stages.${o.stage}`)}
            </Chip>
            <Link href={`/clients/${o.customerId}`} className="font-medium text-ink hover:underline">
              {o.customerName}
            </Link>
            {o.estimatedAmount ? (
              <span className="font-semibold text-ink tabular-nums">
                {formatEuros(BigInt(o.estimatedAmount))}
              </span>
            ) : null}
          </span>
        }
        actions={
          canWrite ? (
            <div className="flex flex-wrap items-end gap-2">
              <SelectField
                label={t('stage')}
                value={o.stage}
                containerClassName="w-48 [&>label]:sr-only"
                onChange={(e) => {
                  const s = e.target.value as OpportunityStage;
                  if (s === 'lost') setDialog('lost');
                  else void moveTo(s);
                }}
                options={OPPORTUNITY_STAGES.map((s) => ({ value: s, label: t(`stages.${s}`) }))}
              />
              <Button
                variant="secondary"
                icon={<Pencil aria-hidden className="size-4" />}
                onClick={() => setDialog('edit')}
              >
                {tc('edit')}
              </Button>
            </div>
          ) : null
        }
      />

      {o.stage === 'lost' && o.lostReason ? (
        <Notice tone="crit" title={t('lostLabel')}>
          {o.lostReason}
        </Notice>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card className="flex flex-col gap-3">
            <Overline>{t('site')}</Overline>
            {siteRow ? (
              <>
                <p className="flex items-start gap-2 text-[15px] font-medium">
                  <MapPin aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span>
                    {siteRow.street}
                    <br />
                    {siteRow.postalCode} {siteRow.city}
                  </span>
                </p>
                {siteRow.accessNotes ? <p className="text-[13px] text-muted">{siteRow.accessNotes}</p> : null}
                {mapsUrl ? (
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-11 items-center gap-2 self-start rounded-[12px] border border-line px-4 text-[15px] font-semibold hover:border-ink/40 focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <Navigation aria-hidden className="size-4" />
                    {t('directions')}
                  </a>
                ) : null}
              </>
            ) : (
              <p className="text-[14px] text-muted">{t('noSite')}</p>
            )}
            {o.description ? <p className="text-[14px] whitespace-pre-line">{o.description}</p> : null}
          </Card>

          {visit ? (
            <VisitEditor key={visit.id} visit={visit} canWrite={canVisit} />
          ) : (
            <Card className="flex flex-col items-start gap-3">
              <CardTitle>{tv('title')}</CardTitle>
              <p className="text-[14px] text-muted">{tv('none')}</p>
              {canVisit ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="lg"
                    icon={<ClipboardCheck aria-hidden className="size-5" />}
                    loading={startVisit.isPending}
                    onClick={() => startVisit.mutate({ trade: o.trade })}
                  >
                    {tv('start')}
                  </Button>
                  <Button
                    size="lg"
                    variant="secondary"
                    icon={<CalendarPlus aria-hidden className="size-5" />}
                    onClick={() => setDialog('plan')}
                  >
                    {tv('plan')}
                  </Button>
                </div>
              ) : null}
            </Card>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          <MediaPanel ownerType="opportunity" ownerId={o.id} canWrite={canVisit} />
          {can('quotes.read') ? (
            <Card className="flex flex-col gap-2">
              <CardTitle as="h3">{t('quote')}</CardTitle>
              <p className="flex items-start gap-2 text-[14px] text-muted">
                <FileText aria-hidden className="mt-0.5 size-4 shrink-0" />
                {t('quoteSoon')}
              </p>
            </Card>
          ) : null}
        </aside>
      </div>

      {dialog === 'edit' ? <EditDialog o={o} onClose={() => setDialog(null)} /> : null}
      {dialog === 'plan' ? (
        <PlanVisitDialog
          loading={startVisit.isPending}
          onClose={() => setDialog(null)}
          onPlan={(scheduledAt) => startVisit.mutate({ scheduledAt, trade: o.trade })}
        />
      ) : null}
      {dialog === 'lost' ? (
        <LostReasonDialog
          onClose={() => setDialog(null)}
          onConfirm={(reason) => {
            setDialog(null);
            void moveTo('lost', reason);
          }}
        />
      ) : null}
    </div>
  );
}

function PlanVisitDialog({
  loading,
  onClose,
  onPlan,
}: {
  loading: boolean;
  onClose: () => void;
  onPlan: (iso: string) => void;
}) {
  const tv = useTranslations('visit');
  const tc = useTranslations('common');
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!value) return setError(true);
    onPlan(new Date(value).toISOString());
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={tv('plan')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="plan-form" loading={loading}>
            {tv('plan')}
          </Button>
        </>
      }
    >
      <form id="plan-form" noValidate onSubmit={submit}>
        <TextField
          label={tv('scheduledAt')}
          type="datetime-local"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={error && !value ? tv('dateRequired') : null}
          autoFocus
          required
        />
      </form>
    </Dialog>
  );
}

function EditDialog({ o, onClose }: { o: OpportunityDto; onClose: () => void }) {
  const t = useTranslations('pipeline');
  const tl = useTranslations('library');
  const tc = useTranslations('common');
  const can = useCan();
  const errorMessage = useErrorMessage();
  const sites = useApi<{
    sites: { id: string; label: string | null; street: string; postalCode: string; city: string }[];
  }>(['customers', o.customerId, 'detail'], `/customers/${o.customerId}`);
  const [v, setV] = useState({
    title: o.title,
    description: o.description ?? '',
    trade: o.trade ?? '',
    siteId: o.siteId ?? '',
    amount: o.estimatedAmount ?? 0,
  });
  const save = useApiMutation<Record<string, unknown>>(
    (body) => ({ path: `/opportunities/${o.id}`, method: 'PUT', body }),
    { invalidate: [['opportunities']], successMessage: tc('saved'), onSuccess: onClose, silentError: true },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (v.title.trim().length < 2) return;
    save.mutate({
      customerId: o.customerId,
      siteId: v.siteId || null,
      title: v.title,
      description: v.description,
      trade: v.trade || null,
      ...(can('pricing.read') ? { estimatedAmount: v.amount || null } : {}),
    });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('edit')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="opp-edit" loading={save.isPending}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <form id="opp-edit" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {save.error ? <Notice tone="crit">{errorMessage(save.error)}</Notice> : null}
        <TextField
          label={t('title_')}
          value={v.title}
          onChange={(e) => setV({ ...v, title: e.target.value })}
          error={v.title.trim().length < 2 ? t('titleRequired') : null}
          required
        />
        <SelectField
          label={t('site')}
          value={v.siteId}
          onChange={(e) => setV({ ...v, siteId: e.target.value })}
          options={[
            { value: '', label: t('noSite') },
            ...(sites.data?.sites ?? []).map((s) => ({
              value: s.id,
              label: `${s.label ? `${s.label} — ` : ''}${s.street}, ${s.postalCode} ${s.city}`,
            })),
          ]}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label={t('trade')}
            value={v.trade}
            onChange={(e) => setV({ ...v, trade: e.target.value })}
            options={[
              { value: '', label: tc('none') },
              ...TRADES.map((x) => ({ value: x, label: tl(`trades.${x}`) })),
            ]}
          />
          {can('pricing.read') ? (
            <MoneyInput
              label={t('estimated')}
              cents={v.amount}
              onChange={(amount) => setV((p) => ({ ...p, amount }))}
            />
          ) : null}
        </div>
        <TextAreaField
          label={t('description')}
          value={v.description}
          onChange={(e) => setV({ ...v, description: e.target.value })}
        />
      </form>
    </Dialog>
  );
}
