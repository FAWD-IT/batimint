'use client';

import type { ProjectDto } from '@batimint/contracts';
import { percentInt, PROJECT_STEPS, VAT_REGIMES } from '@batimint/domain';
import {
  Button,
  Card,
  Chip,
  Dialog,
  Notice,
  SelectField,
  StepBar,
  TextAreaField,
  TextField,
  useToast,
} from '@batimint/ui';
import { Copy, ExternalLink, Pencil, Plus, Send } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { useRelativeTime } from '@/lib/use-relative-time';
import { formatDay } from './status';

function vatChip(project: ProjectDto, t: ReturnType<typeof useTranslations>) {
  const regime = project.vat.regime;
  if (!regime) return null;
  const info = VAT_REGIMES[regime as keyof typeof VAT_REGIMES];
  if (!info) return null;
  const label = info.category === 'AE' ? 'TVA autoliquidée' : `TVA ${info.ratePercent} %`;
  if (regime === 'reduced_6')
    return `${label} · ${project.vat.certificateSigned ? t('header.certificateSigned') : t('header.certificateMissing')}`;
  return label;
}

export function ProjectHeader({
  project,
  onNewChangeOrder,
}: {
  project: ProjectDto;
  onNewChangeOrder: () => void;
}) {
  const t = useTranslations('projects');
  const can = useCan();
  const [editing, setEditing] = useState(false);
  const [portal, setPortal] = useState(false);
  const vat = vatChip(project, t);
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <nav aria-label={t('header.breadcrumb')} className="text-[13px] text-muted">
          <Link href="/chantiers" className="hover:text-ink hover:underline">
            {t('header.breadcrumb')}
          </Link>
          <span aria-hidden> / </span>
          <span>{project.shortLabel.split(' · ')[0]}</span>
        </nav>
        <h1 className="text-[24px] leading-tight font-bold tracking-[-0.025em] text-ink md:text-[30px]">
          {project.name}
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
          {project.site ? <span>{project.site.address}</span> : null}
          <Chip tone="neutral">
            {project.customer.kind === 'company' ? t('header.b2b') : t('header.b2c')}
          </Chip>
          {vat ? <Chip tone="neutral">{vat}</Chip> : null}
          {project.quote ? (
            <Link href={`/devis/${project.quote.id}`} className="hover:text-ink hover:underline">
              {t('header.quote', { number: project.quote.number ?? '' })}
            </Link>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {can('projects.write') ? (
          <>
            <Button
              variant="ghost"
              icon={<Pencil aria-hidden className="size-4" />}
              onClick={() => setEditing(true)}
            >
              <span className="sr-only sm:not-sr-only">{t('header.edit')}</span>
            </Button>
            <Button variant="secondary" onClick={() => setPortal(true)}>
              {t('header.portal')}
            </Button>
            {project.status !== 'closed' ? (
              <Button icon={<Plus aria-hidden className="size-4" />} onClick={onNewChangeOrder}>
                {t('header.newChangeOrder')}
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
      {editing ? <EditProjectDialog project={project} onClose={() => setEditing(false)} /> : null}
      {portal ? <PortalDialog project={project} onClose={() => setPortal(false)} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Statut, jours ouvrés, étapes
// ---------------------------------------------------------------------------

export function StatusCard({ project }: { project: ProjectDto }) {
  const t = useTranslations('projects');
  const can = useCan();
  const [suspending, setSuspending] = useState(false);
  const change = useApiMutation<{ to: string; reason?: string }, ProjectDto>(
    (body) => ({ path: `/projects/${project.id}/status`, body }),
    {
      invalidate: [['project', project.id], ['projects'], ['timeline']],
      successMessage: (_r, v) =>
        t(
          v.to === 'in_progress'
            ? project.status === 'suspended'
              ? 'statusDialog.resumed'
              : 'statusDialog.started'
            : v.to === 'suspended'
              ? 'statusDialog.suspended'
              : 'statusDialog.prepared',
        ),
      onSuccess: () => setSuspending(false),
    },
  );
  const pct = percentInt(project.progress);
  const status = t(`status.${project.status}`);
  const s = project.schedule;
  const headline =
    s.day && s.totalDays
      ? t('schedule.dayOf', { status, day: s.day, total: s.totalDays })
      : project.startDate
        ? t('schedule.notStarted', { status, date: formatDay(project.startDate) })
        : t('schedule.noDates', { status });
  const stepIndex = project.step === 'done' ? PROJECT_STEPS.length : PROJECT_STEPS.indexOf(project.step);
  const steps = PROJECT_STEPS.map((step) =>
    step === 'works' ? t('steps.worksProgress', { percent: pct }) : t(`steps.${step}`),
  );
  const write = can('projects.write');
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[17px] font-semibold">{headline}</h2>
        <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
          {project.schedule.lateDays > 0 ? (
            <Chip tone="warn">{t('schedule.late', { days: project.schedule.lateDays })}</Chip>
          ) : null}
          {project.endDate ? (
            <span>{t('schedule.endPlanned', { date: formatDay(project.endDate) })}</span>
          ) : null}
        </div>
      </div>
      <StepBar
        label={t('steps.label')}
        steps={steps}
        current={stepIndex}
        progress={project.step === 'works' ? pct / 100 : 0}
      />
      {project.status === 'suspended' && project.suspendedReason ? (
        <Notice tone="warn">{t('schedule.suspendedBecause', { reason: project.suspendedReason })}</Notice>
      ) : null}
      {write && ['preparation', 'in_progress', 'suspended'].includes(project.status) ? (
        <div className="flex flex-wrap gap-2">
          {project.allowedTransitions.includes('in_progress') ? (
            <Button
              size="sm"
              variant={project.status === 'preparation' ? 'primary' : 'secondary'}
              loading={change.isPending && change.variables?.to === 'in_progress'}
              onClick={() => change.mutate({ to: 'in_progress' })}
            >
              {project.status === 'suspended' ? t('header.resume') : t('header.start')}
            </Button>
          ) : null}
          {project.allowedTransitions.includes('suspended') ? (
            <Button size="sm" variant="ghost" onClick={() => setSuspending(true)}>
              {t('header.suspend')}
            </Button>
          ) : null}
          {project.status === 'suspended' && project.allowedTransitions.includes('preparation') ? (
            <Button size="sm" variant="ghost" onClick={() => change.mutate({ to: 'preparation' })}>
              {t('header.backToPreparation')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {suspending ? (
        <SuspendDialog
          pending={change.isPending}
          onClose={() => setSuspending(false)}
          onSubmit={(reason) => change.mutate({ to: 'suspended', reason })}
        />
      ) : null}
    </Card>
  );
}

function SuspendDialog({
  pending,
  onClose,
  onSubmit,
}: {
  pending: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const t = useTranslations('projects.statusDialog');
  const tc = useTranslations('common');
  const [reason, setReason] = useState('');
  const [invalid, setInvalid] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return setInvalid(true);
    onSubmit(reason.trim());
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('suspendTitle')}
      description={t('suspendHint')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="suspend-project" loading={pending}>
            {t('suspend')}
          </Button>
        </>
      }
    >
      <form id="suspend-project" onSubmit={submit} noValidate>
        <TextAreaField
          label={t('reason')}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setInvalid(false);
          }}
          error={invalid ? t('reason') : undefined}
          rows={3}
          autoFocus
        />
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Fiche
// ---------------------------------------------------------------------------

function EditProjectDialog({ project, onClose }: { project: ProjectDto; onClose: () => void }) {
  const t = useTranslations('projects.edit');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const people = useApi<{ members: { userId: string; name: string }[] }>(
    ['projects', 'people'],
    '/projects/people',
  );
  const teams = useApi<{ items: { id: string; name: string }[] }>(['teams'], '/teams');
  const [form, setForm] = useState({
    name: project.name,
    description: project.description ?? '',
    managerUserId: project.manager?.userId ?? '',
    teamId: project.team?.id ?? '',
    startDate: project.startDate ?? '',
    endDate: project.endDate ?? '',
  });
  const save = useApiMutation<typeof form, ProjectDto>(
    (f) => ({
      path: `/projects/${project.id}`,
      method: 'PATCH',
      body: {
        name: f.name,
        description: f.description,
        managerUserId: f.managerUserId || null,
        teamId: f.teamId || null,
        startDate: f.startDate || null,
        endDate: f.endDate || null,
      },
    }),
    {
      invalidate: [['project', project.id], ['projects']],
      successMessage: t('saved'),
      onSuccess: onClose,
      silentError: true,
    },
  );
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title')}
      closeLabel={tc('close')}
      className="w-[min(94vw,600px)]"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="edit-project" loading={save.isPending}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <form
        id="edit-project"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(form);
        }}
        className="flex flex-col gap-4"
      >
        {save.error ? <Notice tone="crit">{errorMessage(save.error)}</Notice> : null}
        <TextField
          label={t('name')}
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
          required
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('start')}
            type="date"
            value={form.startDate}
            onChange={(e) => set({ startDate: e.target.value })}
          />
          <TextField
            label={t('end')}
            type="date"
            value={form.endDate}
            min={form.startDate || undefined}
            onChange={(e) => set({ endDate: e.target.value })}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label={t('manager')}
            value={form.managerUserId}
            onChange={(e) => set({ managerUserId: e.target.value })}
            options={[
              { value: '', label: t('noManager') },
              ...(people.data?.members ?? []).map((m) => ({ value: m.userId, label: m.name })),
            ]}
          />
          <SelectField
            label={t('team')}
            value={form.teamId}
            onChange={(e) => set({ teamId: e.target.value })}
            options={[
              { value: '', label: t('noTeam') },
              ...(teams.data?.items ?? []).map((m) => ({ value: m.id, label: m.name })),
            ]}
          />
        </div>
        <TextAreaField
          label={t('description')}
          value={form.description}
          onChange={(e) => set({ description: e.target.value })}
          rows={3}
        />
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Portail client
// ---------------------------------------------------------------------------

function PortalDialog({ project, onClose }: { project: ProjectDto; onClose: () => void }) {
  const t = useTranslations('projects.portalDialog');
  const tc = useTranslations('common');
  const toast = useToast();
  const relative = useRelativeTime();
  const errorMessage = useErrorMessage();
  const [email, setEmail] = useState(project.customer.email ?? '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<null | 'open' | 'copy'>(null);
  const send = useApiMutation<{ email: string; message: string }, { sentTo: string | null }>(
    (body) => ({ path: `/projects/${project.id}/portal-link`, body: { send: true, ...body } }),
    {
      successMessage: (r) => t('sent', { email: r.sentTo ?? '' }),
      onSuccess: onClose,
      silentError: true,
    },
  );
  const link = async (mode: 'open' | 'copy') => {
    setBusy(mode);
    // La fenêtre s'ouvre dans le geste de l'utilisateur, puis reçoit l'adresse (bloqueurs de pop-up).
    const win = mode === 'open' ? window.open('about:blank', '_blank') : null;
    try {
      const r = await api<{ url: string }>(`/projects/${project.id}/portal-link`, { body: { send: false } });
      if (mode === 'open') {
        if (win) win.location.href = r.url;
        else window.open(r.url, '_blank', 'noopener');
      } else {
        await navigator.clipboard.writeText(r.url);
        toast.show({ title: t('copied'), tone: 'good' });
      }
    } catch (err) {
      win?.close();
      toast.show({ title: tc('errorTitle'), description: errorMessage(err), tone: 'crit' });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title')}
      description={t('description')}
      closeLabel={tc('close')}
      className="w-[min(94vw,560px)]"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('close')}
          </Button>
          <Button
            type="submit"
            form="portal-share"
            loading={send.isPending}
            icon={<Send aria-hidden className="size-4" />}
          >
            {t('send')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-muted">
          {project.portal.lastViewedAt
            ? t('lastViewed', { date: relative(project.portal.lastViewedAt) })
            : t('neverViewed')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            loading={busy === 'open'}
            icon={<ExternalLink aria-hidden className="size-4" />}
            onClick={() => void link('open')}
          >
            {t('openPreview')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            loading={busy === 'copy'}
            icon={<Copy aria-hidden className="size-4" />}
            onClick={() => void link('copy')}
          >
            {t('copy')}
          </Button>
        </div>
        <form
          id="portal-share"
          noValidate
          className="flex flex-col gap-4 border-t border-line-soft pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate({ email: email.trim(), message });
          }}
        >
          {send.error ? <Notice tone="crit">{errorMessage(send.error)}</Notice> : null}
          <TextField
            label={t('email')}
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextAreaField
            label={t('message')}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
          />
        </form>
      </div>
    </Dialog>
  );
}
