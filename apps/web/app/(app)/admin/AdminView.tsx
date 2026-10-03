'use client';

import { PLANS, type Plan } from '@batimint/domain';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  PageHeader,
  Segmented,
  Skeleton,
  Switch,
  Table,
  Td,
  TextField,
  Th,
} from '@batimint/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useSession } from '@/lib/session';

interface Overview {
  tenants: number;
  users: number;
  failedJobs: number;
  integrationErrors: number;
  pendingEvents: number;
}
interface TenantRow {
  id: string;
  name: string;
  slug: string;
  plan: Plan;
  featureFlags: Record<string, boolean>;
  trialEndsAt: string | null;
  createdAt: string;
  members: number;
  ownerEmail: string | null;
}
interface Job {
  id: string;
  queue: string;
  retryCount: number;
  data: unknown;
  output: unknown;
  createdOn: string;
}
interface IntegrationRow {
  tenantId: string;
  tenantName: string;
  kind: string;
  provider: string;
  status: string;
  lastError: string | null;
}

type Tab = 'tenants' | 'integrations' | 'jobs';

export function AdminView() {
  const t = useTranslations('admin');
  const ts = useTranslations('settings.subscription');
  const format = useFormatter();
  const me = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('tenants');
  const [q, setQ] = useState('');
  const enabled = me.user.isPlatformAdmin;
  const overview = useApi<Overview>(['admin', 'overview'], enabled ? '/admin/overview' : null);
  const tenants = useApi<{ items: TenantRow[] }>(
    ['admin', 'tenants', q],
    enabled ? `/admin/tenants${q ? `?q=${encodeURIComponent(q)}` : ''}` : null,
  );
  const jobs = useApi<{ items: Job[] }>(['admin', 'jobs'], enabled && tab === 'jobs' ? '/admin/jobs' : null);
  const integrations = useApi<{ items: IntegrationRow[] }>(
    ['admin', 'integrations'],
    enabled && tab === 'integrations' ? '/admin/integrations' : null,
  );
  const patch = useApiMutation<{ id: string; plan?: Plan; featureFlags?: Record<string, boolean> }>(
    ({ id, ...body }) => ({ path: `/admin/tenants/${id}`, method: 'PATCH', body }),
    { invalidate: [['admin']], successMessage: t('saved') },
  );
  const retry = useApiMutation<string>((id) => ({ path: `/admin/jobs/${id}/retry`, method: 'POST' }), {
    invalidate: [['admin']],
    successMessage: t('retried'),
  });
  const [impersonating, setImpersonating] = useState<string | null>(null);

  if (!enabled) return <ErrorState title={t('title')} description={t('forbidden')} />;

  const impersonate = async (id: string) => {
    setImpersonating(id);
    await api(`/admin/tenants/${id}/impersonate`, { method: 'POST' });
    queryClient.clear();
    router.replace('/aujourdhui');
    router.refresh();
  };

  const stats: (keyof Overview)[] = ['tenants', 'users', 'failedJobs', 'integrationErrors', 'pendingEvents'];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader title={t('title')} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {stats.map((k) => (
          <Card key={k} className="p-4 md:p-4">
            <p className="text-[12px] font-semibold tracking-[0.06em] text-muted uppercase">
              {t(`stats.${k}`)}
            </p>
            <p
              className={`text-[30px] font-bold tabular-nums ${k !== 'tenants' && k !== 'users' && (overview.data?.[k] ?? 0) > 0 ? 'text-crit' : ''}`}
            >
              {overview.data ? overview.data[k] : '–'}
            </p>
          </Card>
        ))}
      </div>
      <Segmented<Tab>
        label={t('title')}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'tenants', label: t('tenants') },
          { value: 'integrations', label: t('integrations') },
          { value: 'jobs', label: t('jobs') },
        ]}
      />
      {tab === 'tenants' ? (
        <div className="flex flex-col gap-3">
          <TextField
            label={t('tenants')}
            placeholder="Rénov…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            containerClassName="max-w-sm"
          />
          {tenants.isLoading ? (
            <Skeleton className="h-48" />
          ) : (
            <Table label={t('tenants')}>
              <thead>
                <tr>
                  <Th>{t('tenants')}</Th>
                  <Th>{t('plan')}</Th>
                  <Th className="hidden lg:table-cell">{t('allModules')}</Th>
                  <Th align="right">{t('members')}</Th>
                  <Th align="right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {tenants.data?.items.map((row) => (
                  <tr key={row.id}>
                    <Td>
                      <div className="font-medium">{row.name}</div>
                      <div className="text-[13px] text-muted">
                        {row.ownerEmail ?? '—'} · {t('created')}{' '}
                        {format.dateTime(new Date(row.createdAt), { dateStyle: 'medium' })}
                      </div>
                    </Td>
                    <Td>
                      <select
                        aria-label={`${t('plan')} — ${row.name}`}
                        value={row.plan}
                        onChange={(e) => patch.mutate({ id: row.id, plan: e.target.value as Plan })}
                        className="h-10 rounded-[10px] border border-line bg-surface px-2 text-[14px]"
                      >
                        {PLANS.map((p) => (
                          <option key={p} value={p}>
                            {ts(`plans.${p}`)}
                          </option>
                        ))}
                      </select>
                      {row.trialEndsAt && new Date(row.trialEndsAt) > new Date() ? (
                        <Chip className="ml-2" tone="accent">
                          essai
                        </Chip>
                      ) : null}
                    </Td>
                    <Td className="hidden lg:table-cell">
                      <Switch
                        label={t('allModules')}
                        checked={Boolean(row.featureFlags['all'])}
                        onChange={(v) =>
                          patch.mutate({ id: row.id, featureFlags: { ...row.featureFlags, all: v } })
                        }
                      />
                    </Td>
                    <Td align="right">{row.members}</Td>
                    <Td align="right">
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={impersonating === row.id}
                        onClick={() => void impersonate(row.id)}
                      >
                        {t('impersonate')}
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      ) : tab === 'integrations' ? (
        integrations.isLoading ? (
          <Skeleton className="h-48" />
        ) : !integrations.data?.items.length ? (
          <EmptyState title={t('integrations')} description={t('noIntegrations')} />
        ) : (
          <Table label={t('integrations')}>
            <thead>
              <tr>
                <Th>{t('tenants')}</Th>
                <Th>Type</Th>
                <Th>Statut</Th>
                <Th>{t('error')}</Th>
              </tr>
            </thead>
            <tbody>
              {integrations.data.items.map((r) => (
                <tr key={`${r.tenantId}-${r.kind}`}>
                  <Td>{r.tenantName}</Td>
                  <Td>
                    {r.kind} · <span className="text-muted">{r.provider}</span>
                  </Td>
                  <Td>
                    <Chip tone={r.status === 'active' ? 'good' : r.status === 'error' ? 'crit' : 'warn'} dot>
                      {r.status}
                    </Chip>
                  </Td>
                  <Td className="text-[13px] text-crit">{r.lastError ?? ''}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )
      ) : jobs.isLoading ? (
        <Skeleton className="h-48" />
      ) : !jobs.data?.items.length ? (
        <EmptyState title={t('jobs')} description={t('noJobs')} />
      ) : (
        <Table label={t('jobs')}>
          <thead>
            <tr>
              <Th>{t('queue')}</Th>
              <Th>{t('error')}</Th>
              <Th align="right">{t('attempts')}</Th>
              <Th align="right">
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {jobs.data.items.map((j) => (
              <tr key={j.id}>
                <Td>
                  <code className="text-[13px]">{j.queue}</code>
                  <div className="text-[12px] text-muted">
                    {format.dateTime(new Date(j.createdOn), { dateStyle: 'short', timeStyle: 'short' })}
                  </div>
                </Td>
                <Td className="max-w-md truncate text-[13px] text-crit">{JSON.stringify(j.output ?? '')}</Td>
                <Td align="right">{j.retryCount}</Td>
                <Td align="right">
                  <Button variant="secondary" size="sm" onClick={() => retry.mutate(j.id)}>
                    {t('retry')}
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
