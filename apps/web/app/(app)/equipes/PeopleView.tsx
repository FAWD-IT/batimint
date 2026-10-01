'use client';

import type { EmployeeDto, TenantSettings } from '@batimint/contracts';
import { formatEuros } from '@batimint/domain';
import {
  Avatar,
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
} from '@batimint/ui';
import { HardHat, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { AbsencesPanel } from './AbsencesPanel';
import { EmployeeDrawer } from './EmployeeDrawer';
import { TeamsPanel } from './TeamsPanel';

export interface Team {
  id: string;
  name: string;
  color: string;
  leaderEmployeeId: string | null;
  memberIds: string[];
}

type Tab = 'employees' | 'teams' | 'absences';

export function PeopleView() {
  const t = useTranslations('people');
  const tc = useTranslations('common');
  const can = useCan();
  const errorMessage = useErrorMessage();
  const [tab, setTab] = useState<Tab>('employees');
  const [editing, setEditing] = useState<EmployeeDto | 'new' | null>(null);
  const employees = useApi<{ items: EmployeeDto[] }>(['employees'], '/employees?includeInactive=true');
  const teams = useApi<{ items: Team[] }>(['teams'], '/teams');
  const settings = useApi<TenantSettings>(['settings'], can('company.read') ? '/company/settings' : null);
  const canManage = can('employees.manage');

  if (!can('employees.read'))
    return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;
  if (employees.error) {
    return (
      <ErrorState
        title={tc('errorTitle')}
        description={errorMessage(employees.error)}
        action={<Button onClick={() => void employees.refetch()}>{tc('retry')}</Button>}
      />
    );
  }
  const list = employees.data?.items ?? [];
  const teamList = teams.data?.items ?? [];
  const teamById = new Map(teamList.map((x) => [x.id, x]));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title={t('title')}
        actions={
          canManage && tab === 'employees' ? (
            <Button icon={<Plus aria-hidden className="size-4" />} onClick={() => setEditing('new')}>
              {t('addEmployee')}
            </Button>
          ) : null
        }
      />
      <Segmented<Tab>
        label={t('title')}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'employees', label: t('employees'), count: list.filter((e) => e.active).length },
          { value: 'teams', label: t('teams'), count: teamList.length },
          { value: 'absences', label: t('absences') },
        ]}
      />
      {tab === 'employees' ? (
        employees.isLoading ? (
          <Skeleton className="h-64" />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<HardHat aria-hidden className="size-5" />}
            title={t('employees')}
            description={t('employeesEmpty')}
            action={canManage ? <Button onClick={() => setEditing('new')}>{t('addEmployee')}</Button> : null}
          />
        ) : (
          <Table label={t('employees')}>
            <thead>
              <tr>
                <Th>{tc('name')}</Th>
                <Th className="hidden sm:table-cell">{t('team')}</Th>
                <Th className="hidden md:table-cell">{t('linkedAccount')}</Th>
                {list.some((e) => e.hourlyCost !== undefined) ? (
                  <Th align="right" className="hidden md:table-cell">
                    {t('hourlyCost')}
                  </Th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {list.map((e) => {
                const team = e.teamId ? teamById.get(e.teamId) : undefined;
                return (
                  <tr key={e.id} className={e.active ? undefined : 'opacity-60'}>
                    <Td>
                      <button
                        type="button"
                        disabled={!canManage}
                        onClick={() => setEditing(e)}
                        className="flex min-h-11 items-center gap-3 rounded-[8px] text-left focus-visible:outline-2 focus-visible:outline-accent enabled:hover:underline"
                      >
                        <Avatar name={`${e.firstName} ${e.lastName}`} color={team?.color} />
                        <span>
                          <span className="block font-medium">
                            {e.firstName} {e.lastName}
                          </span>
                          <span className="block text-[13px] text-muted">{e.jobTitle ?? '—'}</span>
                        </span>
                      </button>
                    </Td>
                    <Td className="hidden sm:table-cell">
                      {team ? (
                        <span className="inline-flex items-center gap-2">
                          <span
                            aria-hidden
                            className="size-2.5 rounded-full"
                            style={{ background: team.color }}
                          />
                          {team.name}
                        </span>
                      ) : (
                        <span className="text-muted">{t('noTeam')}</span>
                      )}
                    </Td>
                    <Td className="hidden md:table-cell">
                      {e.userId ? (
                        <Chip tone="good">{t('linkedAccount')}</Chip>
                      ) : (
                        <span className="text-[13px] text-muted">{t('noAccount')}</span>
                      )}
                    </Td>
                    {e.hourlyCost !== undefined ? (
                      <Td align="right" className="hidden md:table-cell">
                        {formatEuros(BigInt(e.hourlyCost))}
                        {tc('perHour')}
                      </Td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )
      ) : tab === 'teams' ? (
        <TeamsPanel
          teams={teamList}
          employees={list.filter((e) => e.active)}
          canManage={can('teams.manage')}
          loading={teams.isLoading}
        />
      ) : (
        <AbsencesPanel employees={list.filter((e) => e.active)} canManage={canManage} />
      )}
      {editing ? (
        <EmployeeDrawer
          employee={editing === 'new' ? null : editing}
          teams={teamList}
          rateProfiles={settings.data?.rateProfiles ?? []}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
