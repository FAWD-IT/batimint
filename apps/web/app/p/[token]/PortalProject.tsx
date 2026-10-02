'use client';

import type { PortalProjectDto } from '@batimint/contracts';
import { formatEuros, formatQuantity, percentInt, PROJECT_STEPS } from '@batimint/domain';
import {
  Button,
  buttonClasses,
  Checkbox,
  Chip,
  cn,
  Dialog,
  Notice,
  StepBar,
  TextAreaField,
  TextField,
} from '@batimint/ui';
import { ChevronDown, FileText, MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { PortalShell } from '@/components/portal/PortalShell';
import { SignaturePad } from '@/components/portal/SignaturePad';
import { api, ApiError } from '@/lib/api';

type ChangeOrder = PortalProjectDto['changeOrders'][number];

const dayFr = (iso: string | null) =>
  iso
    ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('fr-BE', {
        day: 'numeric',
        month: 'long',
        timeZone: 'Europe/Brussels',
      })
    : '';
const timeFr = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-BE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Brussels',
  });

/**
 * Portail chantier (02 P5, P8 ; maquette portail-client) : mobile d'abord, vouvoiement. Le client
 * suit l'avancement, valide les avenants « À valider » ou pose une question, sans compte.
 */
export function PortalProject({ token, initial }: { token: string; initial: PortalProjectDto }) {
  const t = useTranslations('portalProject');
  const [data, setData] = useState(initial);
  const [signing, setSigning] = useState<ChangeOrder | null>(null);
  const [asking, setAsking] = useState<{
    type: 'project' | 'change_order';
    id: string;
    subject: string;
  } | null>(null);
  const [refusing, setRefusing] = useState<ChangeOrder | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const base = `/portal/projects/${encodeURIComponent(token)}`;

  const reload = useCallback(() => {
    api<PortalProjectDto>(base)
      .then(setData)
      .catch(() => undefined);
  }, [base]);

  // En direct : avenant signé au bureau, nouvelle photo, réponse à une question…
  useEffect(() => {
    const source = new EventSource(`/api/v1${base}/stream`);
    source.addEventListener('message', reload);
    return () => source.close();
  }, [base, reload]);

  const p = data.project;
  const pct = percentInt(p.progress);
  const stepIndex = p.step === 'done' ? PROJECT_STEPS.length : PROJECT_STEPS.indexOf(p.step);
  const pending = data.changeOrders.filter((c) => c.status === 'sent');
  const past = data.changeOrders.filter((c) => c.status !== 'sent');
  // L'API ne renvoie un titre « en direct » que pour un événement du jour.
  const live = Boolean(data.headline);

  return (
    <PortalShell accent={data.tenant.accent} tenant={data.tenant} subtitle={p.name} contact={data.contact}>
      <section className="flex flex-col gap-3 pt-1">
        {live ? (
          <p className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: 'var(--accent)' }}>
            <span aria-hidden className="size-2 rounded-full" style={{ background: 'var(--accent)' }} />
            {t('live')}
          </p>
        ) : null}
        <h1 className="text-[28px] leading-[1.15] font-bold tracking-[-0.025em]">
          {p.status === 'preparation' && p.startDate
            ? t('startHeadline', { date: dayFr(p.startDate) })
            : (data.headline?.title ?? t(`status.${p.status}`))}
        </h1>
        <StepBar
          label={t('steps.label')}
          steps={PROJECT_STEPS.map((s) => t(`steps.${s}`))}
          current={stepIndex}
          progress={p.step === 'works' ? pct / 100 : 0}
        />
        <div className="flex flex-wrap justify-between gap-2 text-[14px] text-muted">
          <span>
            {p.status === 'preparation'
              ? p.startDate
                ? t('startPlanned', { date: dayFr(p.startDate) })
                : t('startNotPlanned')
              : t('worksProgress', { percent: pct })}
          </span>
          <span>{p.endDate ? t('endPlanned', { date: dayFr(p.endDate) }) : t('noDate')}</span>
        </div>
      </section>

      {flash ? (
        <Notice tone="good">
          <span role="status">{flash}</span>
        </Notice>
      ) : null}

      {data.photoOfTheDay ? (
        <figure className="overflow-hidden rounded-[16px] border border-line">
          <img
            src={data.photoOfTheDay.url}
            alt={data.photoOfTheDay.caption ?? t('photoOfTheDay')}
            className="aspect-[4/3] w-full object-cover"
          />
          <figcaption className="flex items-baseline justify-between gap-3 px-4 py-3">
            <span className="text-[15px] font-semibold">
              {data.photoOfTheDay.caption ?? t('photoOfTheDay')}
            </span>
            <span className="shrink-0 text-[13px] text-muted">
              {timeFr(data.photoOfTheDay.takenAt)} · {t('photos', { n: data.photoOfTheDay.count })}
            </span>
          </figcaption>
        </figure>
      ) : null}

      {pending.map((co) => (
        <PendingChangeOrder
          key={co.id}
          co={co}
          onSign={() => setSigning(co)}
          onAsk={() =>
            setAsking({ type: 'change_order', id: co.id, subject: t('changeOrder', { n: co.ordinal }) })
          }
          onRefuse={() => setRefusing(co)}
          pdfHref={`/api/v1${base}/change-orders/${co.id}/pdf`}
        />
      ))}

      {past.length ? (
        <section aria-labelledby="portal-co-history" className="flex flex-col gap-2">
          <h2 id="portal-co-history" className="text-[17px] font-semibold">
            {t('history')}
          </h2>
          <ul className="flex flex-col divide-y divide-line-soft rounded-[16px] border border-line">
            {past.map((co) => (
              <li key={co.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold">
                    {t('changeOrder', { n: co.ordinal })} · {co.title}
                  </p>
                  <p className="text-[13px] text-muted">
                    {co.status === 'signed' ? t('signedOn', { date: dayFr(co.signedAt) }) : t('refusedTitle')}{' '}
                    · {t('amount', { amount: formatEuros(BigInt(co.totalNet)) })}
                  </p>
                </div>
                <Chip tone={co.status === 'signed' ? 'good' : 'crit'} dot>
                  {co.status === 'signed' ? t('signedChip') : t('refusedTitle')}
                </Chip>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="portal-docs" className="flex flex-col gap-2">
        <h2 id="portal-docs" className="text-[17px] font-semibold">
          {t('documents')}
        </h2>
        {data.documents.length === 0 ? (
          <p className="text-[14px] text-muted">{t('noDocuments')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-soft rounded-[16px] border border-line">
            {data.documents.map((d) => (
              <li key={`${d.kind}-${d.id}`}>
                <a
                  href={d.href}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-12 items-center gap-3 px-4 py-2 hover:bg-line-soft/50"
                >
                  <FileText aria-hidden className="size-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate text-[15px]">{d.title}</span>
                  {d.date ? <span className="shrink-0 text-[12px] text-muted">{dayFr(d.date)}</span> : null}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.timeline.length ? (
        <section aria-labelledby="portal-news" className="flex flex-col gap-2">
          <h2 id="portal-news" className="text-[17px] font-semibold">
            {t('timeline')}
          </h2>
          <ol className="flex flex-col gap-3">
            {data.timeline.slice(0, 8).map((e) => (
              <li key={e.id} className="grid grid-cols-[70px_minmax(0,1fr)] gap-3">
                <span className="text-[13px] text-muted">{dayFr(e.occurredAt)}</span>
                <span>
                  <span className="block text-[15px] font-medium">{e.title}</span>
                  {e.body ? <span className="block text-[13px] text-muted">{e.body}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section aria-labelledby="portal-thread" className="flex flex-col gap-2">
        <h2 id="portal-thread" className="text-[17px] font-semibold">
          {t('projectThread')}
        </h2>
        <Thread thread={data.thread} />
        <Button
          variant="secondary"
          className="self-start"
          icon={<MessageCircle aria-hidden className="size-4" />}
          onClick={() => setAsking({ type: 'project', id: '', subject: p.name })}
        >
          {t('ask')}
        </Button>
      </section>

      {signing ? (
        <SignDialog
          co={signing}
          signer={data.customer.displayName}
          onClose={() => setSigning(null)}
          onSign={async (body) => {
            const next = await api<PortalProjectDto>(`${base}/change-orders/${signing.id}/sign`, { body });
            setData(next);
            setSigning(null);
            setFlash(t('signed', { n: signing.ordinal }));
          }}
        />
      ) : null}
      {asking ? (
        <QuestionDialog
          subject={asking.subject}
          onClose={() => setAsking(null)}
          onSend={async (text) => {
            const next = await api<PortalProjectDto>(`${base}/comments`, {
              body: {
                subjectType: asking.type,
                ...(asking.type === 'change_order' ? { subjectId: asking.id } : {}),
                body: text,
              },
            });
            setData(next);
            setAsking(null);
            setFlash(t('questionSent'));
          }}
        />
      ) : null}
      {refusing ? (
        <RefuseDialog
          co={refusing}
          onClose={() => setRefusing(null)}
          onRefuse={async (reason) => {
            const next = await api<PortalProjectDto>(`${base}/change-orders/${refusing.id}/refuse`, {
              body: { reason: reason || null },
            });
            setData(next);
            setRefusing(null);
            setFlash(t('refused'));
          }}
        />
      ) : null}
    </PortalShell>
  );
}

function Thread({ thread }: { thread: PortalProjectDto['thread'] }) {
  const t = useTranslations('portalProject');
  if (!thread.length) return null;
  return (
    <ol className="flex flex-col gap-2" aria-label={t('thread')}>
      {thread.map((c) => (
        <li
          key={c.id}
          className={cn(
            'max-w-[85%] rounded-[14px] px-3 py-2 text-[14px]',
            c.fromClient ? 'self-end bg-line-soft' : 'self-start border border-line',
          )}
        >
          <p className="text-[12px] font-semibold text-muted">
            {c.fromClient ? t('you') : c.authorLabel} · {timeFr(c.createdAt)}
          </p>
          <p className="whitespace-pre-wrap">{c.body}</p>
        </li>
      ))}
    </ol>
  );
}

function PendingChangeOrder({
  co,
  onSign,
  onAsk,
  onRefuse,
  pdfHref,
}: {
  co: ChangeOrder;
  onSign: () => void;
  onAsk: () => void;
  onRefuse: () => void;
  pdfHref: string;
}) {
  const t = useTranslations('portalProject');
  const [open, setOpen] = useState(false);
  return (
    <section
      aria-labelledby={`co-${co.id}`}
      className="flex flex-col gap-3 rounded-[16px] bg-panel p-4 text-white"
      data-testid="portal-change-order"
    >
      <div className="flex items-baseline justify-between gap-3 text-[12px] tracking-[0.08em] text-panel-muted uppercase">
        <span className="font-semibold">{t('toValidate')}</span>
        <span className="tracking-normal normal-case">{t('changeOrder', { n: co.ordinal })}</span>
      </div>
      <h2 id={`co-${co.id}`} className="text-[20px] leading-tight font-bold">
        {co.title}
      </h2>
      <p className="text-[14px] text-panel-muted">
        +{t('amount', { amount: formatEuros(BigInt(co.totalNet)) })} ·{' '}
        {co.delayDays > 0 && co.newEndDate ? t('delay', { date: dayFr(co.newEndDate) }) : t('noDelay')}
      </p>
      {co.description ? (
        <p className="text-[14px] whitespace-pre-wrap text-white/90">{co.description}</p>
      ) : null}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`co-lines-${co.id}`}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 self-start text-[13px] font-semibold text-white underline-offset-2 hover:underline"
      >
        {open ? t('hideDetails') : t('details')}
        <ChevronDown aria-hidden className={cn('size-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div
          id={`co-lines-${co.id}`}
          className="flex flex-col gap-2 rounded-[12px] bg-white/10 p-3 text-[14px]"
        >
          <ul className="flex flex-col gap-1.5">
            {co.lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>
                  {l.description}
                  <span className="block text-[12px] text-panel-muted">
                    {formatQuantity(l.quantity)} {l.unit}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">{formatEuros(BigInt(l.netAmount))}</span>
              </li>
            ))}
          </ul>
          <p className="flex justify-between border-t border-white/15 pt-2 font-semibold">
            <span>{t('totalGross')}</span>
            <span className="tabular-nums">{formatEuros(BigInt(co.totalGross))}</span>
          </p>
          <a href={pdfHref} target="_blank" rel="noreferrer" className="self-start text-[13px] underline">
            {t('pdf')}
          </a>
        </div>
      ) : null}
      {co.thread.length ? (
        <div className="rounded-[12px] bg-white p-3 text-ink">
          <Thread thread={co.thread} />
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="inverse" size="lg" onClick={onSign}>
          {t('validate')}
        </Button>
        <button
          type="button"
          onClick={onAsk}
          className={cn(
            buttonClasses('ghost', 'lg'),
            'border border-white/30 text-white hover:bg-white/10 hover:text-white',
          )}
        >
          {t('ask')}
        </button>
      </div>
      <button
        type="button"
        onClick={onRefuse}
        className="self-center text-[13px] text-panel-muted underline-offset-2 hover:text-white hover:underline"
      >
        {t('refuse')}
      </button>
    </section>
  );
}

function SignDialog({
  co,
  signer,
  onClose,
  onSign,
}: {
  co: ChangeOrder;
  signer: string;
  onClose: () => void;
  onSign: (body: { signerName: string; acceptTerms: true; signaturePath: string | null }) => Promise<void>;
}) {
  const t = useTranslations('portalProject');
  const tp = useTranslations('portal');
  const [name, setName] = useState(signer);
  const [terms, setTerms] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!terms) return setError(t('termsRequired'));
    setBusy(true);
    setError(null);
    try {
      await onSign({ signerName: name.trim(), acceptTerms: true, signaturePath: path });
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : tp('errors.generic'));
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('signTitle', { n: co.ordinal })}
      description={t('signIntro')}
      closeLabel={tp('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tp('close')}
          </Button>
          <Button type="submit" form="co-sign" variant="accent" loading={busy}>
            {t('sign')}
          </Button>
        </>
      }
    >
      <form id="co-sign" noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        {error ? <Notice tone="crit">{error}</Notice> : null}
        <p className="flex items-baseline justify-between rounded-[12px] bg-line-soft px-3 py-2 text-[15px]">
          <span>{co.title}</span>
          <span className="font-semibold tabular-nums">{formatEuros(BigInt(co.totalGross))}</span>
        </p>
        <TextField
          label={t('signerName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
        />
        <SignaturePad onChange={setPath} />
        <Checkbox label={t('acceptTerms')} checked={terms} onChange={(e) => setTerms(e.target.checked)} />
      </form>
    </Dialog>
  );
}

function QuestionDialog({
  subject,
  onClose,
  onSend,
}: {
  subject: string;
  onClose: () => void;
  onSend: (text: string) => Promise<void>;
}) {
  const t = useTranslations('portalProject');
  const tp = useTranslations('portal');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (text.trim().length < 2) return setError(t('questionTooShort'));
    setBusy(true);
    try {
      await onSend(text.trim());
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : tp('errors.generic'));
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('questionTitle', { subject })}
      closeLabel={tp('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tp('close')}
          </Button>
          <Button type="submit" form="portal-question" variant="accent" loading={busy}>
            {t('questionSend')}
          </Button>
        </>
      }
    >
      <form id="portal-question" noValidate onSubmit={(e) => void submit(e)}>
        <TextAreaField
          label={t('questionLabel')}
          rows={4}
          value={text}
          autoFocus
          error={error}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
      </form>
    </Dialog>
  );
}

function RefuseDialog({
  co,
  onClose,
  onRefuse,
}: {
  co: ChangeOrder;
  onClose: () => void;
  onRefuse: (reason: string) => Promise<void>;
}) {
  const t = useTranslations('portalProject');
  const tp = useTranslations('portal');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('refuseTitle', { n: co.ordinal })}
      closeLabel={tp('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tp('close')}
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onRefuse(reason.trim());
              } catch (err) {
                setError(err instanceof ApiError && err.message ? err.message : tp('errors.generic'));
                setBusy(false);
              }
            }}
          >
            {t('refuseSubmit')}
          </Button>
        </>
      }
    >
      {error ? <Notice tone="crit">{error}</Notice> : null}
      <TextAreaField
        label={t('refuseReason')}
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    </Dialog>
  );
}
