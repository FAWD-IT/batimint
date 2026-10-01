'use client';

import { Button, ErrorState, PageHeader, Segmented } from '@batimint/ui';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { OpportunityDialog } from '@/components/crm/OpportunityDialog';
import { useApi } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { Kanban } from './Kanban';
import { LeadDialog } from './LeadDialog';
import { LeadsInbox, type LeadRow } from './LeadsInbox';

type Tab = 'pipeline' | 'leads';

export function OpportunitiesView({ initialTab }: { initialTab: Tab }) {
  const t = useTranslations('pipeline');
  const tl = useTranslations('leads');
  const tc = useTranslations('common');
  const can = useCan();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [dialog, setDialog] = useState<'opportunity' | 'lead' | null>(null);
  const leads = useApi<{ items: LeadRow[] }>(['leads'], can('leads.read') ? '/leads' : null);

  if (!can('leads.read'))
    return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;

  const switchTab = (next: Tab) => {
    setTab(next);
    router.replace(next === 'leads' ? '/opportunites?vue=demandes' : '/opportunites', { scroll: false });
  };
  const newLeads = leads.data?.items.filter((l) => l.status === 'new').length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('title')}
        actions={
          can('leads.write') ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setDialog('lead')}>
                {tl('new')}
              </Button>
              <Button icon={<Plus aria-hidden className="size-4" />} onClick={() => setDialog('opportunity')}>
                {t('new')}
              </Button>
            </div>
          ) : null
        }
      />
      <Segmented<Tab>
        label={t('title')}
        value={tab}
        onChange={switchTab}
        options={[
          { value: 'pipeline', label: t('tabs.pipeline') },
          { value: 'leads', label: t('tabs.leads'), ...(newLeads ? { count: newLeads } : {}) },
        ]}
      />
      {tab === 'pipeline' ? <Kanban /> : <LeadsInbox query={leads} onNew={() => setDialog('lead')} />}
      {dialog === 'opportunity' ? (
        <OpportunityDialog
          onClose={() => setDialog(null)}
          onCreated={(o) => router.push(`/opportunites/${o.id}`)}
        />
      ) : null}
      {dialog === 'lead' ? <LeadDialog onClose={() => setDialog(null)} /> : null}
    </div>
  );
}
