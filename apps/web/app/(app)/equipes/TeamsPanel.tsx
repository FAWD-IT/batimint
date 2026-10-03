'use client';

import type { EmployeeDto } from '@batimint/contracts';
import {
  Avatar,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  EmptyState,
  SelectField,
  Skeleton,
  TextField,
} from '@batimint/ui';
import { Plus, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { useApiMutation } from '@/lib/hooks';
import type { Team } from './PeopleView';

const COLORS = ['#2F4BFF', '#1E7B45', '#B4570B', '#B42318', '#6B3FA0', '#0E7490', '#111111'];

export function TeamsPanel({
  teams,
  employees,
  canManage,
  loading,
}: {
  teams: Team[];
  employees: EmployeeDto[];
  canManage: boolean;
  loading: boolean;
}) {
  const t = useTranslations('people');
  const tc = useTranslations('common');
  const [editing, setEditing] = useState<Team | 'new' | null>(null);
  const [archiving, setArchiving] = useState<Team | null>(null);
  const byId = new Map(employees.map((e) => [e.id, e]));
  const archive = useApiMutation<string>((id) => ({ path: `/teams/${id}`, method: 'DELETE' }), {
    invalidate: [['teams'], ['employees']],
    successMessage: tc('saved'),
    onSuccess: () => setArchiving(null),
  });
  if (loading) return <Skeleton className="h-48" />;
  return (
    <div className="flex flex-col gap-4">
      {teams.length === 0 ? (
        <EmptyState
          icon={<Users aria-hidden className="size-5" />}
          title={t('teams')}
          description={t('teamsEmpty')}
          action={canManage ? <Button onClick={() => setEditing('new')}>{t('addTeam')}</Button> : null}
        />
      ) : (
        <>
          {canManage ? (
            <Button
              className="self-start"
              variant="secondary"
              icon={<Plus aria-hidden className="size-4" />}
              onClick={() => setEditing('new')}
            >
              {t('addTeam')}
            </Button>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {teams.map((team) => {
              const leader = team.leaderEmployeeId ? byId.get(team.leaderEmployeeId) : undefined;
              return (
                <Card key={team.id} className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <span aria-hidden className="size-3 rounded-full" style={{ background: team.color }} />
                    <h3 className="flex-1 text-[17px] font-semibold">{team.name}</h3>
                    {canManage ? (
                      <Button variant="ghost" size="sm" onClick={() => setEditing(team)}>
                        {tc('edit')}
                      </Button>
                    ) : null}
                  </div>
                  {leader ? (
                    <p className="text-[13px] text-muted">
                      {t('leader')} : {leader.firstName} {leader.lastName}
                    </p>
                  ) : null}
                  <ul className="flex flex-wrap gap-2">
                    {team.memberIds.map((id) => {
                      const e = byId.get(id);
                      if (!e) return null;
                      return (
                        <li
                          key={id}
                          className="flex items-center gap-2 rounded-full border border-line py-1 pr-3 pl-1 text-[13px]"
                        >
                          <Avatar name={`${e.firstName} ${e.lastName}`} size={24} color={team.color} />
                          {e.firstName} {e.lastName}
                        </li>
                      );
                    })}
                  </ul>
                  {canManage ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="self-start text-muted"
                      onClick={() => setArchiving(team)}
                    >
                      {t('archiveTeam')}
                    </Button>
                  ) : null}
                </Card>
              );
            })}
          </div>
        </>
      )}
      {editing ? (
        <TeamDialog
          team={editing === 'new' ? null : editing}
          employees={employees}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        onConfirm={() => archiving && archive.mutate(archiving.id)}
        title={t('archiveTeam')}
        description={archiving?.name}
        confirmLabel={t('archiveTeam')}
        cancelLabel={tc('cancel')}
        closeLabel={tc('close')}
        destructive
        loading={archive.isPending}
      />
    </div>
  );
}

function TeamDialog({
  team,
  employees,
  onClose,
}: {
  team: Team | null;
  employees: EmployeeDto[];
  onClose: () => void;
}) {
  const t = useTranslations('people');
  const tc = useTranslations('common');
  const [name, setName] = useState(team?.name ?? '');
  const [color, setColor] = useState(team?.color ?? COLORS[0]!);
  const [leader, setLeader] = useState(team?.leaderEmployeeId ?? '');
  const [members, setMembers] = useState<string[]>(team?.memberIds ?? []);
  const save = useApiMutation<Record<string, unknown>>(
    (body) => (team ? { path: `/teams/${team.id}`, method: 'PUT', body } : { path: '/teams', body }),
    { invalidate: [['teams'], ['employees']], successMessage: t('teamSaved'), onSuccess: onClose },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const memberIds = leader && !members.includes(leader) ? [...members, leader] : members;
    save.mutate({ name: name.trim(), color, leaderEmployeeId: leader || null, memberIds });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={team ? t('editTeam') : t('addTeam')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="team-form" loading={save.isPending} disabled={!name.trim()}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <form id="team-form" onSubmit={submit} className="flex flex-col gap-4">
        <TextField label={t('teamName')} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <fieldset>
          <legend className="mb-2 text-[13px] font-semibold">{t('teamColor')}</legend>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <label key={c} className="relative cursor-pointer">
                <input
                  type="radio"
                  name="color"
                  value={c}
                  checked={color === c}
                  onChange={() => setColor(c)}
                  className="peer sr-only"
                  aria-label={c}
                />
                <span
                  aria-hidden
                  className="block size-9 rounded-full border-2 border-transparent peer-checked:border-ink peer-focus-visible:outline-2 peer-focus-visible:outline-accent"
                  style={{ background: c }}
                />
              </label>
            ))}
          </div>
        </fieldset>
        <SelectField
          label={t('leader')}
          value={leader}
          onChange={(e) => setLeader(e.target.value)}
          options={[
            { value: '', label: '—' },
            ...employees.map((e) => ({ value: e.id, label: `${e.firstName} ${e.lastName}` })),
          ]}
        />
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-[13px] font-semibold">{t('members')}</legend>
          {employees.map((e) => (
            <label
              key={e.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[8px] px-2 hover:bg-line-soft"
            >
              <input
                type="checkbox"
                className="size-5 accent-[var(--ink)]"
                checked={members.includes(e.id)}
                onChange={(ev) =>
                  setMembers(ev.target.checked ? [...members, e.id] : members.filter((x) => x !== e.id))
                }
              />
              {e.firstName} {e.lastName}
              {e.jobTitle ? <span className="text-[13px] text-muted">· {e.jobTitle}</span> : null}
            </label>
          ))}
        </fieldset>
      </form>
    </Dialog>
  );
}
