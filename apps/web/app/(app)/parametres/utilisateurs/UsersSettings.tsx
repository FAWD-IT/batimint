'use client';

import { assignableRoles, type Role } from '@batimint/domain';
import {
  Avatar,
  Button,
  Chip,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Table,
  Td,
  TextField,
  Th,
} from '@batimint/ui';
import { MailPlus, RotateCw, UserPlus, X } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useRealtimeListener } from '@/lib/realtime';
import { useCan, useSession } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { useQueryClient } from '@tanstack/react-query';

interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  status: 'active' | 'disabled';
  lastLoginAt: string | null;
  isCurrentUser: boolean;
}
interface Invitation {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: string;
  expiresAt: string;
}

export function UsersSettings() {
  const t = useTranslations('settings.users');
  const ts = useTranslations('settings');
  const tr = useTranslations('roles');
  const tc = useTranslations('common');
  const format = useFormatter();
  const can = useCan();
  const me = useSession();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const canManage = can('members.manage');
  const { data, error, isLoading, refetch } = useApi<{ members: Member[]; invitations: Invitation[] }>(
    ['members'],
    '/members',
  );
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirm, setConfirm] = useState<Member | null>(null);
  useRealtimeListener(
    (m) => m.topic === 'members' && void queryClient.invalidateQueries({ queryKey: ['members'] }),
  );

  const update = useApiMutation<{ id: string; role?: Role; status?: 'active' | 'disabled' }>(
    ({ id, ...body }) => ({ path: `/members/${id}`, method: 'PATCH', body }),
    { invalidate: [['members']], successMessage: tc('saved'), onSuccess: () => setConfirm(null) },
  );
  const resend = useApiMutation<string>((id) => ({ path: `/invitations/${id}/resend`, method: 'POST' }), {
    invalidate: [['members']],
    successMessage: t('resent'),
  });
  const revoke = useApiMutation<string>((id) => ({ path: `/invitations/${id}`, method: 'DELETE' }), {
    invalidate: [['members'], ['onboarding']],
    successMessage: t('revoked'),
  });

  if (!can('members.read'))
    return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;
  if (error)
    return (
      <ErrorState
        title={tc('errorTitle')}
        description={errorMessage(error)}
        action={<Button onClick={() => void refetch()}>{tc('retry')}</Button>}
      />
    );

  const roles = me.role ? assignableRoles(me.role) : [];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        breadcrumb={<Link href="/parametres">{ts('title')}</Link>}
        title={t('title')}
        actions={
          canManage ? (
            <Button icon={<UserPlus aria-hidden className="size-4" />} onClick={() => setInviteOpen(true)}>
              {t('invite')}
            </Button>
          ) : null
        }
      />
      {isLoading || !data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <Table label={t('members')}>
            <thead>
              <tr>
                <Th>{tc('name')}</Th>
                <Th>{tc('role')}</Th>
                <Th className="hidden md:table-cell">{t('lastLogin')}</Th>
                <Th align="right">
                  <span className="sr-only">{tc('actions')}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => {
                const editable = canManage && !m.isCurrentUser && (m.role !== 'owner' || me.role === 'owner');
                return (
                  <tr key={m.id} className={m.status === 'disabled' ? 'opacity-60' : undefined}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={m.name} />
                        <div className="min-w-0">
                          <div className="font-medium">
                            {m.name}{' '}
                            {m.isCurrentUser ? <span className="text-muted">({t('you')})</span> : null}
                          </div>
                          <div className="truncate text-[13px] text-muted">{m.email}</div>
                        </div>
                        {m.status === 'disabled' ? <Chip tone="neutral">{t('disabled')}</Chip> : null}
                      </div>
                    </Td>
                    <Td>
                      {editable ? (
                        <select
                          aria-label={`${tc('role')} — ${m.name}`}
                          value={m.role}
                          onChange={(e) => update.mutate({ id: m.id, role: e.target.value as Role })}
                          className="h-10 rounded-[10px] border border-line bg-surface px-2 text-[14px] focus-visible:outline-2 focus-visible:outline-accent"
                        >
                          {roles.map((r) => (
                            <option key={r} value={r}>
                              {tr(r)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        tr(m.role)
                      )}
                    </Td>
                    <Td className="hidden text-muted md:table-cell">
                      {m.lastLoginAt ? format.relativeTime(new Date(m.lastLoginAt)) : t('never')}
                    </Td>
                    <Td align="right">
                      {editable ? (
                        m.status === 'active' ? (
                          <Button variant="ghost" size="sm" onClick={() => setConfirm(m)}>
                            {t('disable')}
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => update.mutate({ id: m.id, status: 'active' })}
                          >
                            {t('enable')}
                          </Button>
                        )
                      ) : null}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>

          <section className="flex flex-col gap-3" aria-labelledby="pending-title">
            <h2 id="pending-title" className="text-[15px] font-semibold">
              {t('pending')}
            </h2>
            {data.invitations.length === 0 ? (
              <p className="text-[14px] text-muted">{t('pendingEmpty')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.invitations.map((i) => (
                  <li
                    key={i.id}
                    className="flex flex-wrap items-center gap-3 rounded-[12px] border border-line bg-surface px-4 py-3"
                  >
                    <MailPlus aria-hidden className="size-4 text-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{i.name ? `${i.name} · ${i.email}` : i.email}</div>
                      <div className="text-[13px] text-muted">
                        {tr(i.role)} ·{' '}
                        {t('expires', {
                          date: format.dateTime(new Date(i.expiresAt), { dateStyle: 'medium' }),
                        })}
                      </div>
                    </div>
                    {canManage ? (
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<RotateCw aria-hidden className="size-4" />}
                          onClick={() => resend.mutate(i.id)}
                        >
                          {t('resend')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<X aria-hidden className="size-4" />}
                          onClick={() => revoke.mutate(i.id)}
                        >
                          {t('revoke')}
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {data.members.length === 1 && data.invitations.length === 0 && canManage ? (
            <EmptyState
              title={t('inviteTitle')}
              description={t('inviteDescription')}
              action={<Button onClick={() => setInviteOpen(true)}>{t('invite')}</Button>}
            />
          ) : null}
        </>
      )}
      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} roles={roles} />
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && update.mutate({ id: confirm.id, status: 'disabled' })}
        title={t('disable')}
        description={confirm ? t('disableConfirm', { name: confirm.name }) : undefined}
        confirmLabel={t('disable')}
        cancelLabel={tc('cancel')}
        closeLabel={tc('close')}
        destructive
        loading={update.isPending}
      />
    </div>
  );
}

function InviteDialog({ open, onClose, roles }: { open: boolean; onClose: () => void; roles: Role[] }) {
  const t = useTranslations('settings.users');
  const tr = useTranslations('roles');
  const tc = useTranslations('common');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('office');
  const [emailError, setEmailError] = useState<string | null>(null);
  const invite = useApiMutation<{ email: string; name: string; role: Role }>(
    (body) => ({ path: '/invitations', body }),
    {
      invalidate: [['members'], ['onboarding']],
      successMessage: (_r, vars) => t('inviteSent', { email: vars.email }),
      onSuccess: () => {
        setEmail('');
        setName('');
        onClose();
      },
    },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailError('Indiquez une adresse e-mail valide.');
      return;
    }
    setEmailError(null);
    invite.mutate({ email: email.trim(), name: name.trim(), role });
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('inviteTitle')}
      description={t('inviteDescription')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="invite-form" loading={invite.isPending}>
            {t('invite')}
          </Button>
        </>
      }
    >
      <form id="invite-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={tc('email')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={emailError}
          autoFocus
        />
        <TextField
          label={tc('name')}
          optionalLabel={tc('optional')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-semibold">{tc('role')}</legend>
          {roles.map((r) => (
            <label
              key={r}
              className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[10px] border border-line p-3 has-[:checked]:border-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
            >
              <input
                type="radio"
                name="role"
                value={r}
                checked={role === r}
                onChange={() => setRole(r)}
                className="mt-1 size-4 accent-[var(--ink)]"
              />
              <span>
                <span className="block text-[14px] font-semibold">{tr(r)}</span>
                <span className="block text-[13px] text-muted">{t(`roleDescriptions.${r}`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </form>
    </Dialog>
  );
}
