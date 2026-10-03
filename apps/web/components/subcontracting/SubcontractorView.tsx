'use client';

import type {
  SubcontractorDetailDto,
  SubcontractorDocumentKind,
  ThirtyBisCheckDto,
} from '@batimint/contracts';
import { formatEnterpriseNumber, formatEuros } from '@batimint/domain';
import {
  Button,
  Card,
  CardTitle,
  Chip,
  ConfirmDialog,
  ErrorState,
  Notice,
  PageHeader,
  Skeleton,
  Table,
  Td,
  Th,
} from '@batimint/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FileUp, Plus, Send, ShieldCheck, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { DocumentUploadDialog } from './DocumentUploadDialog';
import {
  ComplianceChip,
  CONTRACT_STATUS_TONE,
  DOC_STATUS_TONE,
  formatDateTime,
  formatDay,
  ThirtyBisChip,
} from './shared';
import { SubcontractDialog } from './SubcontractDialog';
import { SubcontractDrawer } from './SubcontractDrawer';

/** Fiche sous-traitant (03 §9, P9) : documents obligatoires, contrats, consultations 30bis, portail. */
export function SubcontractorView({ id }: { id: string }) {
  const t = useTranslations('subcontracting');
  const tc = useTranslations('common');
  const can = useCan();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const detail = useApi<SubcontractorDetailDto>(['subcontractors', 'detail', id], `/subcontractors/${id}`);
  const [upload, setUpload] = useState<{ kind?: SubcontractorDocumentKind } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const invalidate = [['subcontractors'], ['subcontracts']];
  const check = useApiMutation<void, ThirtyBisCheckDto>(
    () => ({ path: `/subcontractors/${id}/thirty-bis-check`, method: 'POST' }),
    {
      invalidate,
      successMessage: (c) => (c.hasSocialDebt || c.hasTaxDebt ? t('checkDebt') : t('checkClear')),
    },
  );
  const invite = useApiMutation<void, { email: string }>(
    () => ({ path: `/subcontractors/${id}/invite`, method: 'POST', body: {} }),
    { invalidate, successMessage: (r) => t('contract.invited', { email: r.email }) },
  );
  const remove = useApiMutation<string, unknown>(
    (docId) => ({ path: `/subcontractor-documents/${docId}`, method: 'DELETE' }),
    { invalidate, successMessage: t('documents.removed'), onSuccess: () => setRemoving(null) },
  );

  if (detail.error)
    return (
      <ErrorState
        title={
          detail.error instanceof ApiError && detail.error.status === 404 ? t('notFound') : tc('errorTitle')
        }
        description={errorMessage(detail.error)}
        action={
          <Link href="/sous-traitance" className="font-medium text-accent hover:underline">
            {t('backToList')}
          </Link>
        }
      />
    );
  if (!detail.data)
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-6" aria-busy="true">
        <Skeleton className="h-20" />
        <Skeleton className="h-72" />
      </div>
    );
  const s = detail.data;
  const write = can('subcontracting.write');
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        breadcrumb={
          <Link href="/sous-traitance" className="hover:underline">
            {t('title')}
          </Link>
        }
        title={s.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">
              {s.enterpriseNumber ? formatEnterpriseNumber(s.enterpriseNumber) : t('noEnterpriseNumber')}
            </span>
            {s.email ? <span>· {s.email}</span> : null}
            {s.phone ? <span>· {s.phone}</span> : null}
          </span>
        }
        actions={
          write ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                icon={<ShieldCheck aria-hidden className="size-4" />}
                loading={check.isPending}
                disabled={!s.enterpriseNumber}
                onClick={() => check.mutate()}
              >
                {t('checkNow')}
              </Button>
              <Button
                variant="secondary"
                icon={<Send aria-hidden className="size-4" />}
                loading={invite.isPending}
                onClick={() => invite.mutate()}
              >
                {s.portalInvitedAt ? t('reinvite') : t('invite')}
              </Button>
              <Button icon={<Plus aria-hidden className="size-4" />} onClick={() => setCreating(true)}>
                {t('contract.new')}
              </Button>
            </div>
          ) : null
        }
      />
      {!s.enterpriseNumber ? <Notice tone="warn">{t('enterpriseNumberMissing')}</Notice> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle as="h2">{t('documents.title')}</CardTitle>
            <ComplianceChip compliance={s.compliance} />
          </div>
          <ul className="flex flex-col divide-y divide-line-soft">
            {s.compliance.requirements.map((r) => (
              <li key={r.kind} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="flex flex-col">
                  <span className="text-[14px] font-medium">{t(`documentKinds.${r.kind}`)}</span>
                  <span className="text-[12px] text-muted">
                    {r.status === 'missing'
                      ? t('documents.missing')
                      : r.expiresOn
                        ? t('documents.until', { date: formatDay(r.expiresOn) })
                        : t('documents.noExpiry')}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Chip tone={DOC_STATUS_TONE[r.status] ?? 'neutral'} dot>
                    {t(`documentStatus.${r.status}`)}
                  </Chip>
                  {write && r.status !== 'valid' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<FileUp aria-hidden className="size-4" />}
                      onClick={() => setUpload({ kind: r.kind })}
                    >
                      {t('documents.add')}
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          {s.documents.length ? (
            <Table label={t('documents.all')}>
              <thead>
                <tr>
                  <Th>{t('documents.document')}</Th>
                  <Th className="hidden sm:table-cell">{t('documents.expiresOn')}</Th>
                  <Th align="right">
                    <span className="sr-only">{tc('actions')}</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {s.documents.map((d) => (
                  <tr key={d.id}>
                    <Td>
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex min-h-11 flex-col justify-center hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        <span className="font-medium">{t(`documentKinds.${d.kind}`)}</span>
                        <span className="text-[12px] text-muted">
                          {d.fileName}
                          {d.source === 'portal' ? ` · ${t('documents.fromPortal')}` : ''}
                        </span>
                      </a>
                    </Td>
                    <Td className="hidden sm:table-cell">
                      <span className="flex items-center gap-2">
                        {formatDay(d.expiresOn)}
                        <Chip tone={DOC_STATUS_TONE[d.status] ?? 'neutral'}>
                          {t(`documentStatus.${d.status}`)}
                        </Chip>
                      </span>
                    </Td>
                    <Td align="right">
                      {write ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('documents.remove', { name: d.fileName })}
                          icon={<Trash2 aria-hidden className="size-4" />}
                          onClick={() => setRemoving(d.id)}
                        />
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : null}
          {write ? (
            <Button
              variant="secondary"
              size="sm"
              className="w-fit"
              icon={<FileUp aria-hidden className="size-4" />}
              onClick={() => setUpload({})}
            >
              {t('documents.addOther')}
            </Button>
          ) : null}
        </Card>

        <Card className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle as="h2">{t('thirtyBis.title')}</CardTitle>
            <ThirtyBisChip check={s.lastCheck} />
          </div>
          <p className="text-[14px] text-muted">{t('thirtyBis.explain')}</p>
          {s.checks.length === 0 ? (
            <p className="text-[14px] text-muted">{t('thirtyBis.none')}</p>
          ) : (
            <ol className="flex flex-col divide-y divide-line-soft">
              {s.checks.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[14px]"
                >
                  <span className="flex flex-col">
                    <span className="font-medium">
                      {t(`thirtyBis.context.${c.context}`)}
                      {c.subcontractNumber ? ` · ${c.subcontractNumber}` : ''}
                      {c.supplierInvoiceNumber ? ` · ${c.supplierInvoiceNumber}` : ''}
                    </span>
                    <span className="text-[12px] text-muted">
                      {formatDateTime(c.checkedAt)} · {c.reference}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <ThirtyBisChip check={c} />
                    {c.proofUrl ? (
                      <a
                        href={c.proofUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={t('thirtyBis.proofOf', { date: formatDateTime(c.checkedAt) })}
                        className="inline-flex size-11 items-center justify-center rounded-[10px] text-accent hover:bg-line-soft focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        <ExternalLink aria-hidden className="size-4" />
                      </a>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <section aria-labelledby="contracts-title" className="flex flex-col gap-3">
        <h2 id="contracts-title" className="text-[17px] font-semibold">
          {t('contracts')}
        </h2>
        {s.contracts.length === 0 ? (
          <p className="text-[14px] text-muted">{t('noContracts')}</p>
        ) : (
          <Table label={t('contracts')}>
            <thead>
              <tr>
                <Th>{t('contract.number')}</Th>
                <Th className="hidden md:table-cell">{t('contract.project')}</Th>
                <Th>{t('contract.status.label')}</Th>
                <Th align="right">{t('contract.amount')}</Th>
              </tr>
            </thead>
            <tbody>
              {s.contracts.map((c) => (
                <tr key={c.id} className="hover:bg-line-soft/40">
                  <Td>
                    <button
                      type="button"
                      onClick={() => setOpen(c.id)}
                      className="flex min-h-11 flex-col justify-center text-left focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      <span className="font-medium hover:underline">{c.number}</span>
                      <span className="text-[12px] text-muted">{c.title}</span>
                    </button>
                  </Td>
                  <Td className="hidden md:table-cell">
                    {c.project.number} — {c.project.name}
                  </Td>
                  <Td>
                    <Chip tone={CONTRACT_STATUS_TONE[c.status] ?? 'neutral'} dot>
                      {t(`contract.status.${c.status}`)}
                    </Chip>
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {formatEuros(BigInt(c.amount))}
                    <span className="block text-[12px] text-muted">
                      {t('contract.invoicedShort', { amount: formatEuros(BigInt(c.invoiced)) })}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      {upload ? (
        <DocumentUploadDialog
          path={`/subcontractors/${id}/documents`}
          kind={upload.kind}
          onClose={() => setUpload(null)}
          onUploaded={() => {
            setUpload(null);
            void queryClient.invalidateQueries({ queryKey: ['subcontractors'] });
            void queryClient.invalidateQueries({ queryKey: ['subcontracts'] });
          }}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
        title={t('documents.removeTitle')}
        description={t('documents.removeDescription')}
        confirmLabel={t('documents.removeConfirm')}
        cancelLabel={tc('cancel')}
        closeLabel={tc('close')}
        destructive
        loading={remove.isPending}
      />
      {creating ? (
        <SubcontractDialog
          supplierId={id}
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            setCreating(false);
            setOpen(c.id);
          }}
        />
      ) : null}
      {open ? <SubcontractDrawer id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
