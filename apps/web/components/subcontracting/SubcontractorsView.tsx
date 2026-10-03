'use client';

import type { SubcontractorSummaryDto, SubcontractSummaryDto } from '@batimint/contracts';
import { formatEnterpriseNumber, formatEuros } from '@batimint/domain';
import { Button, EmptyState, ErrorState, PageHeader, Segmented, Skeleton, Table, Td, Th } from '@batimint/ui';
import { Handshake, Plus, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { SupplierDialog } from '@/components/purchasing/SuppliersView';
import { useApi } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { useNewParam } from '@/lib/use-new-param';
import { ComplianceChip, formatDateTime, ThirtyBisChip } from './shared';
import { ContractCard } from './SubcontractingTab';
import { SubcontractDialog } from './SubcontractDialog';
import { SubcontractDrawer } from './SubcontractDrawer';

type View = 'subcontractors' | 'contracts';

/** Sous-traitance (03 §9) : sous-traitants (conformité, 30bis) et contrats en cours. */
export function SubcontractorsView() {
  const t = useTranslations('subcontracting');
  const tc = useTranslations('common');
  const can = useCan();
  const router = useRouter();
  const search = useSearchParams();
  const errorMessage = useErrorMessage();
  const view: View = search.get('vue') === 'contrats' ? 'contracts' : 'subcontractors';
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(search.get('contrat'));
  useNewParam(() => can('subcontracting.write') && setCreating(true));
  const subs = useApi<{ items: SubcontractorSummaryDto[] }>(
    ['subcontractors', 'list'],
    can('subcontracting.read') ? '/subcontractors' : null,
  );
  const contracts = useApi<{ items: SubcontractSummaryDto[] }>(
    ['subcontracts', 'list', 'active'],
    can('subcontracting.read') && view === 'contracts' ? '/subcontracts?status=active' : null,
  );
  if (!can('subcontracting.read'))
    return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;
  const items = subs.data?.items ?? [];
  const failing = items.filter((s) => !s.compliance.compliant).length;
  const current = view === 'contracts' ? contracts : subs;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title={t('title')}
        description={
          subs.data
            ? failing
              ? t('summaryIssues', { n: items.length, issues: failing })
              : t('summary', { n: items.length })
            : undefined
        }
        actions={
          can('subcontracting.write') ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                icon={<UserPlus aria-hidden className="size-4" />}
                onClick={() => setAdding(true)}
              >
                {t('add')}
              </Button>
              <Button icon={<Plus aria-hidden className="size-4" />} onClick={() => setCreating(true)}>
                {t('contract.new')}
              </Button>
            </div>
          ) : null
        }
      />
      <Segmented
        label={t('views.label')}
        value={view}
        onChange={(v) =>
          router.replace(v === 'contracts' ? '/sous-traitance?vue=contrats' : '/sous-traitance')
        }
        options={[
          { value: 'subcontractors', label: t('views.subcontractors') },
          { value: 'contracts', label: t('views.contracts') },
        ]}
      />
      {current.error ? (
        <ErrorState
          title={tc('errorTitle')}
          description={errorMessage(current.error)}
          action={<Button onClick={() => void current.refetch()}>{tc('retry')}</Button>}
        />
      ) : current.isLoading ? (
        <Skeleton className="h-72" />
      ) : view === 'contracts' ? (
        (contracts.data?.items ?? []).length === 0 ? (
          <EmptyState
            icon={<Handshake aria-hidden className="size-5" />}
            title={t('contractsEmptyTitle')}
            description={t('contractsEmpty')}
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {(contracts.data?.items ?? []).map((s) => (
              <li key={s.id}>
                <ContractCard contract={s} onOpen={() => setOpen(s.id)} />
              </li>
            ))}
          </ul>
        )
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Handshake aria-hidden className="size-5" />}
          title={t('emptyTitle')}
          description={t('empty')}
          action={
            can('subcontracting.write') ? <Button onClick={() => setAdding(true)}>{t('add')}</Button> : null
          }
        />
      ) : (
        <Table label={t('title')}>
          <thead>
            <tr>
              <Th>{tc('name')}</Th>
              <Th>{t('columns.compliance')}</Th>
              <Th className="hidden md:table-cell">{t('columns.thirtyBis')}</Th>
              <Th align="right" className="hidden sm:table-cell">
                {t('columns.contracts')}
              </Th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id} className="hover:bg-line-soft/40">
                <Td>
                  <Link
                    href={`/sous-traitance/${s.id}`}
                    className="flex min-h-11 flex-col justify-center rounded-[8px] focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <span className="font-medium hover:underline">{s.name}</span>
                    <span className="font-mono text-[12px] text-muted">
                      {s.enterpriseNumber
                        ? formatEnterpriseNumber(s.enterpriseNumber)
                        : t('noEnterpriseNumber')}
                    </span>
                  </Link>
                </Td>
                <Td>
                  <ComplianceChip compliance={s.compliance} />
                </Td>
                <Td className="hidden md:table-cell">
                  <span className="flex flex-col items-start gap-1">
                    <ThirtyBisChip check={s.lastCheck} />
                    {s.lastCheck ? (
                      <span className="text-[12px] text-muted">{formatDateTime(s.lastCheck.checkedAt)}</span>
                    ) : null}
                  </span>
                </Td>
                <Td align="right" className="hidden tabular-nums sm:table-cell">
                  {s.activeContracts ? (
                    <>
                      {t('activeContracts', { n: s.activeContracts })}
                      <span className="block text-[12px] text-muted">
                        {formatEuros(BigInt(s.contractedAmount))}
                      </span>
                    </>
                  ) : (
                    '—'
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {creating ? (
        <SubcontractDialog
          onClose={() => setCreating(false)}
          onCreated={(s) => {
            setCreating(false);
            setOpen(s.id);
          }}
        />
      ) : null}
      {adding ? (
        <SupplierDialog
          supplier={null}
          subcontractor
          onClose={() => setAdding(false)}
          onCreated={(s) => {
            setAdding(false);
            router.push(`/sous-traitance/${s.id}`);
          }}
        />
      ) : null}
      {open ? <SubcontractDrawer id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
