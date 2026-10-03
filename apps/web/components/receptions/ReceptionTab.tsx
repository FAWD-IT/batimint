'use client';

import type { ProfitabilityDto, ProjectDto, ProjectReceptionDto, ReceptionDto } from '@batimint/contracts';
import { formatEuros, formatPercent } from '@batimint/domain';
import {
  Button,
  buttonClasses,
  Card,
  CardTitle,
  Checkbox,
  Chip,
  ConfirmDialog,
  ErrorState,
  Notice,
  Skeleton,
  StepBar,
  Table,
  Td,
  Th,
} from '@batimint/ui';
import { CheckCircle2, ExternalLink, FileSignature, Lock, Receipt } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { ReceptionSheet } from './ReceptionSheet';

const day = (d: string | null | undefined) =>
  d
    ? new Intl.DateTimeFormat('fr-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(d.length === 10 ? `${d}T00:00:00Z` : d),
      )
    : '—';

/** Onglet « Réception » du cockpit (P10) : PV, réserves, facture finale, garantie, clôture, rentabilité. */
export function ReceptionTab({ project }: { project: ProjectDto }) {
  const t = useTranslations('reception');
  const tc = useTranslations('common');
  const can = useCan();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const data = useApi<ProjectReceptionDto>(['reception', project.id], `/projects/${project.id}/reception`);
  const [sheet, setSheet] = useState<'provisional' | 'final' | null>(null);
  const [closing, setClosing] = useState(false);
  const invalidate = [['reception', project.id], ['project'], ['invoices'], ['timeline']];
  const lift = useApiMutation<string, ProjectReceptionDto>(
    (id) => ({ path: `/reserves/${id}/lift`, method: 'POST' }),
    { invalidate, successMessage: t('lifted') },
  );
  const finalInvoice = useApiMutation<void, { invoiceId: string }>(
    () => ({ path: `/projects/${project.id}/final-invoice`, method: 'POST' }),
    { invalidate, successMessage: t('finalInvoiceReady'), onSuccess: (r) => router.push(`/facturation/${r.invoiceId}`) },
  );
  const close = useApiMutation<void, ProjectDto>(
    () => ({ path: `/projects/${project.id}/close`, method: 'POST' }),
    { invalidate, successMessage: t('closed'), onSuccess: () => setClosing(false) },
  );

  if (data.error)
    return (
      <ErrorState
        title={tc('errorTitle')}
        description={errorMessage(data.error)}
        action={<Button onClick={() => void data.refetch()}>{tc('retry')}</Button>}
      />
    );
  if (!data.data) return <Skeleton className="h-72" />;
  const r = data.data;
  const manage = can('receptions.manage');
  const signed = r.receptions.filter((x) => x.status === 'signed');
  const steps = [
    { key: 'works', done: r.projectStatus !== 'preparation' },
    { key: 'provisional', done: Boolean(r.provisionalAcceptedOn) },
    { key: 'final', done: Boolean(r.finalAcceptedOn) },
    { key: 'closed', done: Boolean(r.closedAt) },
  ];
  const current = steps.findIndex((s) => !s.done);

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle as="h2">{t('title')}</CardTitle>
            <p className="text-[14px] text-muted">
              {r.closedAt
                ? t('statusClosed', { date: day(r.closedAt) })
                : r.finalAcceptedOn
                  ? t('statusFinal', { date: day(r.finalAcceptedOn) })
                  : r.provisionalAcceptedOn
                    ? t('statusProvisional', {
                        date: day(r.provisionalAcceptedOn),
                        planned: day(r.finalAcceptancePlannedOn),
                      })
                    : t('statusWorks')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {manage && r.can.provisional ? (
              <Button icon={<FileSignature aria-hidden className="size-4" />} onClick={() => setSheet('provisional')}>
                {t('startProvisional')}
              </Button>
            ) : null}
            {can('invoices.write') && r.can.finalInvoice ? (
              <Button
                variant="secondary"
                icon={<Receipt aria-hidden className="size-4" />}
                loading={finalInvoice.isPending}
                onClick={() => finalInvoice.mutate()}
              >
                {t('generateFinalInvoice')}
              </Button>
            ) : null}
            {manage && r.can.final ? (
              <Button icon={<FileSignature aria-hidden className="size-4" />} onClick={() => setSheet('final')}>
                {t('startFinal')}
              </Button>
            ) : null}
            {can('projects.write') && r.can.close ? (
              <Button variant="secondary" icon={<Lock aria-hidden className="size-4" />} onClick={() => setClosing(true)}>
                {t('close')}
              </Button>
            ) : null}
          </div>
        </div>
        <StepBar
          label={t('steps.label')}
          steps={steps.map((s) => t(`steps.${s.key}`))}
          current={current === -1 ? steps.length : current}
          progress={current === 0 ? 1 : 0}
        />
        {r.provisionalAcceptedOn && !r.finalAcceptedOn && r.openReserves > 0 ? (
          <Notice tone="warn">{t('openReserves', { n: r.openReserves })}</Notice>
        ) : null}
        <dl className="grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-3">
          <Fact label={t('retentionHeld')} value={formatEuros(BigInt(r.retention.held))} />
          <Fact
            label={t('retentionReleased')}
            value={r.retention.released ? `${formatEuros(BigInt(r.retention.released))} · ${day(r.retention.releasedAt)}` : '—'}
          />
          <div className="flex flex-col gap-0.5">
            <dt className="text-[12px] text-muted">{t('finalInvoice')}</dt>
            <dd>
              {r.finalInvoice ? (
                <Link href={`/facturation/${r.finalInvoice.id}`} className="font-medium text-accent hover:underline">
                  {r.finalInvoice.number ?? t('finalInvoiceDraft')}
                </Link>
              ) : (
                '—'
              )}
            </dd>
          </div>
        </dl>
      </Card>

      {signed.length ? (
        <section aria-labelledby="pv-title" className="flex flex-col gap-3">
          <h2 id="pv-title" className="text-[17px] font-semibold">
            {t('reports')}
          </h2>
          {signed.map((x) => (
            <ReceptionCard
              key={x.id}
              reception={x}
              canLift={manage}
              lifting={lift.isPending ? lift.variables : null}
              onLift={(id) => lift.mutate(id)}
            />
          ))}
        </section>
      ) : (
        <Notice>{t('noReport')}</Notice>
      )}

      {project.financials ? <ProfitabilityCard projectId={project.id} status={r.projectStatus} /> : null}

      {sheet ? (
        <ReceptionSheet
          kind={sheet}
          projectId={project.id}
          customerName={project.customer.displayName}
          posts={project.budgetLines.map((b) => ({ id: b.id, label: b.label }))}
          onClose={() => setSheet(null)}
          onSigned={() => {
            setSheet(null);
            void data.refetch();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={closing}
        onClose={() => setClosing(false)}
        onConfirm={() => close.mutate()}
        title={t('closeTitle')}
        description={t('closeDescription')}
        confirmLabel={t('close')}
        cancelLabel={tc('cancel')}
        closeLabel={tc('close')}
        loading={close.isPending}
      />
    </div>
  );
}

function ReceptionCard({
  reception: x,
  canLift,
  lifting,
  onLift,
}: {
  reception: ReceptionDto;
  canLift: boolean;
  lifting: string | null | undefined;
  onLift: (id: string) => void;
}) {
  const t = useTranslations('reception');
  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="reception-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col">
          <span className="font-semibold">
            {x.kind === 'provisional' ? t('provisional') : t('final')} · {x.number}
          </span>
          <span className="text-[13px] text-muted">
            {t('signedBy', { name: x.signerName ?? '', date: day(x.receptionDate) })}
          </span>
        </div>
        {x.pdfUrl ? (
          <a href={x.pdfUrl} target="_blank" rel="noreferrer" className={buttonClasses('secondary', 'sm')}>
            <ExternalLink aria-hidden className="size-4" />
            {t('pdf')}
          </a>
        ) : null}
      </div>
      {x.kind === 'provisional' ? (
        x.reserves.length ? (
          <ul className="flex flex-col divide-y divide-line-soft">
            {x.reserves.map((rv) => (
              <li key={rv.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[14px]">
                <span className="flex min-w-0 flex-col">
                  <span className={rv.liftedAt ? 'text-muted line-through' : 'font-medium'}>{rv.description}</span>
                  <span className="text-[12px] text-muted">
                    {[rv.location, rv.budgetLine?.label].filter(Boolean).join(' · ') || ' '}
                  </span>
                  {rv.photos.length ? (
                    <span className="mt-1 flex gap-1.5">
                      {rv.photos.map((p) => (
                        <img key={p.id} src={p.thumbUrl ?? p.url} alt="" className="size-12 rounded-[8px] object-cover" />
                      ))}
                    </span>
                  ) : null}
                </span>
                {rv.liftedAt ? (
                  <Chip tone="good" dot>
                    {t('liftedOn', { date: day(rv.liftedAt) })}
                  </Chip>
                ) : canLift ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<CheckCircle2 aria-hidden className="size-4" />}
                    loading={lifting === rv.id}
                    onClick={() => onLift(rv.id)}
                  >
                    {t('lift')}
                  </Button>
                ) : (
                  <Chip tone="warn" dot>
                    {t('toLift')}
                  </Chip>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] text-muted">{t('noReserves')}</p>
        )
      ) : null}
    </Card>
  );
}

function ProfitabilityCard({ projectId, status }: { projectId: string; status: string }) {
  const t = useTranslations('reception.profitability');
  const can = useCan();
  const data = useApi<ProfitabilityDto>(['reception', projectId, 'profitability'], `/projects/${projectId}/profitability`);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const apply = useApiMutation<void, { updated: number }>(
    () => ({
      path: `/projects/${projectId}/price-suggestions/apply`,
      method: 'POST',
      body: {
        items: (data.data?.suggestions ?? [])
          .filter((s) => chosen.has(`${s.itemId}:${s.field}`))
          .map((s) => ({ itemId: s.itemId, field: s.field, value: s.suggested })),
      },
    }),
    {
      invalidate: [['reception', projectId], ['library']],
      successMessage: (r) => t('applied', { n: r.updated }),
      onSuccess: () => setChosen(new Set()),
    },
  );
  if (!data.data) return data.isLoading ? <Skeleton className="h-60" /> : null;
  const r = data.data;
  const pct = (v: string | null) => (v === null ? '—' : formatPercent(v));
  const finished = ['final_acceptance', 'closed'].includes(status);
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <CardTitle as="h2">{finished ? t('titleFinal') : t('title')}</CardTitle>
          <p className="text-[14px] text-muted">{t('subtitle')}</p>
        </div>
        <div className="flex gap-6 text-right">
          <Kpi label={t('plannedMargin')} value={pct(r.plannedMargin)} />
          <Kpi label={t('actualMargin')} value={pct(r.actualMargin)} strong />
        </div>
      </div>
      <Table label={t('byPost')}>
        <thead>
          <tr>
            <Th>{t('post')}</Th>
            <Th align="right">{t('budgeted')}</Th>
            <Th align="right">{t('actual')}</Th>
            <Th align="right" className="hidden sm:table-cell">
              {t('variance')}
            </Th>
            <Th align="right" className="hidden md:table-cell">
              {t('hours')}
            </Th>
          </tr>
        </thead>
        <tbody>
          {r.posts.map((p) => (
            <tr key={p.id}>
              <Td className="font-medium">{p.label}</Td>
              <Td align="right" className="tabular-nums">
                {formatEuros(BigInt(p.budgetedCost))}
              </Td>
              <Td align="right" className="tabular-nums">
                {formatEuros(BigInt(p.actualCost))}
              </Td>
              <Td
                align="right"
                className={`hidden tabular-nums sm:table-cell ${p.costVariance > 0 ? 'text-crit' : 'text-good'}`}
              >
                {p.costVarianceRatio === null ? '—' : `${p.costVariance > 0 ? '+' : ''}${formatPercent(p.costVarianceRatio)}`}
              </Td>
              <Td align="right" className="hidden tabular-nums md:table-cell">
                {t('hoursValue', { actual: p.actualHours.replace('.', ','), planned: p.plannedHours.replace('.', ',') })}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {r.suggestions.length ? (
        <section aria-labelledby="suggestions-title" className="flex flex-col gap-3 border-t border-line-soft pt-4">
          <h3 id="suggestions-title" className="text-[15px] font-semibold">
            {t('suggestions')}
          </h3>
          <p className="text-[14px] text-muted">{t('suggestionsHelp')}</p>
          <ul className="flex flex-col gap-2">
            {r.suggestions.map((s) => {
              const key = `${s.itemId}:${s.field}`;
              const fmt = (v: string) =>
                s.field === 'unitCost' ? formatEuros(BigInt(v)) : t('hoursUnit', { n: v.replace('.', ',') });
              return (
                <li key={key}>
                  <Checkbox
                    label={t(`suggestion.${s.field}`, {
                      item: `${s.itemName} (${s.itemCode})`,
                      from: fmt(s.current),
                      to: fmt(s.suggested),
                      variance: formatPercent(s.variance),
                    })}
                    checked={chosen.has(key)}
                    disabled={!can('library.write')}
                    onChange={(e) =>
                      setChosen((c) => {
                        const n = new Set(c);
                        if (e.target.checked) n.add(key);
                        else n.delete(key);
                        return n;
                      })
                    }
                  />
                </li>
              );
            })}
          </ul>
          {can('library.write') ? (
            <Button className="w-fit" disabled={!chosen.size} loading={apply.isPending} onClick={() => apply.mutate()}>
              {t('apply', { n: chosen.size })}
            </Button>
          ) : null}
        </section>
      ) : finished ? (
        <p className="text-[14px] text-muted">{t('noSuggestion')}</p>
      ) : null}
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function Kpi({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[12px] text-muted">{label}</span>
      <span className={strong ? 'text-[20px] font-bold tabular-nums' : 'text-[16px] tabular-nums'}>{value}</span>
    </div>
  );
}
