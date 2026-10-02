'use client';

import type { ProjectDto, ProjectTodoDto } from '@batimint/contracts';
import { Button, ErrorState, Skeleton } from '@batimint/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { BudgetTab } from '@/components/projects/BudgetTab';
import { ChangeOrderDrawer } from '@/components/projects/ChangeOrderDrawer';
import { ChangeOrdersTab } from '@/components/projects/ChangeOrdersTab';
import { FieldTab } from '@/components/projects/FieldTab';
import { ProjectHeader, StatusCard } from '@/components/projects/Header';
import { MediaTab } from '@/components/projects/MediaTab';
import { MarginCard, ProgressCard, TodoCard } from '@/components/projects/Overview';
import { TabPanel, Tabs } from '@/components/projects/Tabs';
import { TasksTab } from '@/components/projects/TasksTab';
import { PurchasesTab } from '@/components/purchasing/PurchasesTab';
import { ProjectTimeline } from '@/components/projects/Timeline';
import { ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useRealtime } from '@/lib/realtime';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';

type Tab = 'overview' | 'tasks' | 'field' | 'media' | 'changeOrders' | 'purchases' | 'budget';
const TAB_PARAM: Record<Tab, string> = {
  overview: '',
  tasks: 'taches',
  field: 'terrain',
  media: 'photos',
  changeOrders: 'avenants',
  purchases: 'achats',
  budget: 'budget',
};
const PARAM_TAB = Object.fromEntries(Object.entries(TAB_PARAM).map(([k, v]) => [v, k])) as Record<
  string,
  Tab
>;

/** Cockpit du chantier (maquette cockpit-chantier) : tout ce qui bouge sur le chantier, en direct. */
export function ProjectCockpit({ id }: { id: string }) {
  const t = useTranslations('projects');
  const tc = useTranslations('common');
  const can = useCan();
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { addChannels } = useRealtime();
  const project = useApi<ProjectDto>(['project', id], `/projects/${id}`);
  const [drawer, setDrawer] = useState<{ id: string | null; post?: string | null } | null>(null);

  useEffect(() => addChannels([`project:${id}`]), [addChannels, id]);
  // Lien direct vers un avenant (notification, fil) : ?avenant=…
  const coParam = search.get('avenant');
  useEffect(() => {
    if (coParam) setDrawer({ id: coParam });
  }, [coParam]);

  const tab: Tab = PARAM_TAB[search.get('onglet') ?? ''] ?? 'overview';
  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
  };
  const setTab = (v: Tab) => setParams({ onglet: TAB_PARAM[v] || null });
  const openCo = (coId: string | null, post?: string | null) => setDrawer({ id: coId, post: post ?? null });
  const closeDrawer = () => {
    setDrawer(null);
    if (coParam) setParams({ avenant: null });
  };

  if (project.error)
    return (
      <ErrorState
        title={
          project.error instanceof ApiError && project.error.status === 404 ? t('notFound') : tc('errorTitle')
        }
        description={errorMessage(project.error)}
        action={<Button onClick={() => void project.refetch()}>{tc('retry')}</Button>}
      />
    );
  if (!project.data)
    return (
      <div className="mx-auto flex max-w-[1180px] flex-col gap-6" aria-busy="true">
        <Skeleton className="h-20" />
        <Skeleton className="h-28" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  const p = project.data;
  const onTodo = (todo: ProjectTodoDto) => {
    switch (todo.kind) {
      case 'budget_drift':
        return openCo(null, todo.ref);
      case 'change_order_draft':
      case 'change_order_awaiting':
        return openCo(todo.ref);
      case 'client_question':
        return todo.changeOrderId ? openCo(todo.changeOrderId) : setTab('overview');
      case 'project_late':
        return undefined;
      case 'invoice_overdue':
        return undefined;
    }
  };
  const tabs = [
    { value: 'overview' as const, label: t('tabs.overview') },
    { value: 'tasks' as const, label: t('tabs.tasks'), count: p.counts.openTasks },
    { value: 'field' as const, label: t('tabs.field'), count: p.counts.openIssues },
    { value: 'media' as const, label: t('tabs.media'), count: p.counts.photos + p.counts.documents },
    { value: 'changeOrders' as const, label: t('tabs.changeOrders'), count: p.counts.changeOrders },
    ...(can('purchases.read') ? [{ value: 'purchases' as const, label: t('tabs.purchases') }] : []),
    ...(p.financials ? [{ value: 'budget' as const, label: t('tabs.budget') }] : []),
  ];

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-6">
      <ProjectHeader project={p} onNewChangeOrder={() => openCo(null)} />
      <StatusCard project={p} />
      <Tabs label={t('tabs.label')} value={tab} onChange={setTab} items={tabs} idPrefix="project" />
      <TabPanel value={tab} idPrefix="project">
        {tab === 'overview' ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <div className="order-2 min-w-0 lg:order-1">
              <ProjectTimeline projectId={p.id} onOpenChangeOrder={(coId) => openCo(coId)} />
            </div>
            <div className="order-1 flex min-w-0 flex-col gap-6 lg:order-2">
              <MarginCard project={p} onPlanChangeOrder={(post) => openCo(null, post)} />
              <ProgressCard project={p} />
              <TodoCard project={p} onAction={onTodo} />
            </div>
          </div>
        ) : tab === 'tasks' ? (
          <TasksTab project={p} />
        ) : tab === 'field' ? (
          <FieldTab projectId={p.id} onOpenChangeOrder={(coId) => openCo(coId)} />
        ) : tab === 'media' ? (
          <MediaTab projectId={p.id} />
        ) : tab === 'changeOrders' ? (
          <ChangeOrdersTab projectId={p.id} onOpen={(coId) => openCo(coId)} onNew={() => openCo(null)} />
        ) : tab === 'purchases' ? (
          <PurchasesTab project={p} />
        ) : (
          <BudgetTab project={p} />
        )}
      </TabPanel>
      {drawer && can('projects.read') ? (
        <ChangeOrderDrawer
          project={p}
          changeOrderId={drawer.id}
          prefillBudgetLineId={drawer.post ?? null}
          onClose={closeDrawer}
        />
      ) : null}
    </div>
  );
}
