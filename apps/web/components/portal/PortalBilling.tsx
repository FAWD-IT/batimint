'use client';

import type { PortalProjectDto } from '@batimint/contracts';
import { formatEuros } from '@batimint/domain';
import { Button, buttonClasses, Chip, cn, Dialog, Notice, TextAreaField, TextField } from '@batimint/ui';
import { ChevronDown, CreditCard, FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';

type Statement = PortalProjectDto['statements'][number];
type Invoice = PortalProjectDto['invoices'][number];

const dayFr = (iso: string | null) =>
  iso
    ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('fr-BE', {
        day: 'numeric',
        month: 'long',
        timeZone: 'Europe/Brussels',
      })
    : '';
const pct = (v: string) => `${Number(v).toLocaleString('fr-BE', { maximumFractionDigits: 1 })} %`;

/** État d'avancement à approuver (02 P7.2), vouvoiement. */
export function PendingStatement({
  statement: st,
  onApprove,
  onDispute,
}: {
  statement: Statement;
  onApprove: () => void;
  onDispute: () => void;
}) {
  const t = useTranslations('portalProject.statement');
  const [open, setOpen] = useState(false);
  return (
    <section
      aria-labelledby={`st-${st.id}`}
      className="flex flex-col gap-3 rounded-[16px] bg-panel p-4 text-white"
      data-testid="portal-statement"
    >
      <div className="flex items-baseline justify-between gap-3 text-[12px] tracking-[0.08em] text-panel-muted uppercase">
        <span className="font-semibold">{t('toApprove')}</span>
        <span className="tracking-normal normal-case">{t('asOf', { date: dayFr(st.periodEnd) })}</span>
      </div>
      <h2 id={`st-${st.id}`} className="text-[20px] leading-tight font-bold">
        {t('title', { n: st.ordinal, pct: pct(st.cumulativePercent) })}
      </h2>
      <p className="text-[14px] text-panel-muted">
        {t('amount', { amount: formatEuros(BigInt(st.periodAmount)) })}
      </p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`st-lines-${st.id}`}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 self-start text-[13px] font-semibold text-white underline-offset-2 hover:underline"
      >
        {open ? t('hideDetails') : t('details')}
        <ChevronDown aria-hidden className={cn('size-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <ul
          id={`st-lines-${st.id}`}
          className="flex flex-col gap-1.5 rounded-[12px] bg-white/10 p-3 text-[14px]"
        >
          {st.lines.map((l) => (
            <li key={l.label} className="flex justify-between gap-3">
              <span>
                {l.label}
                <span className="block text-[12px] text-panel-muted">
                  {t('progress', { from: pct(l.previousPercent), to: pct(l.cumulativePercent) })}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">{formatEuros(BigInt(l.periodAmount))}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="inverse" size="lg" onClick={onApprove}>
          {t('approve')}
        </Button>
        <button
          type="button"
          onClick={onDispute}
          className={cn(
            buttonClasses('ghost', 'lg'),
            'border border-white/30 text-white hover:bg-white/10 hover:text-white',
          )}
        >
          {t('dispute')}
        </button>
      </div>
    </section>
  );
}

export function StatementDecisionDialog({
  statement: st,
  mode,
  signer,
  onClose,
  onDone,
  base,
}: {
  statement: Statement;
  mode: 'approve' | 'dispute';
  signer: string;
  onClose: () => void;
  onDone: (next: PortalProjectDto) => void;
  base: string;
}) {
  const t = useTranslations('portalProject.statement');
  const tp = useTranslations('portal');
  const [name, setName] = useState(signer);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (mode === 'approve' && name.trim().length < 2) return setError(t('nameRequired'));
    if (mode === 'dispute' && reason.trim().length < 3) return setError(t('reasonRequired'));
    setBusy(true);
    setError(null);
    try {
      const next = await api<PortalProjectDto>(`${base}/progress-statements/${st.id}/decision`, {
        body:
          mode === 'approve'
            ? { decision: 'approve', signerName: name.trim() }
            : { decision: 'dispute', reason: reason.trim() },
      });
      onDone(next);
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : tp('errors.generic'));
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={mode === 'approve' ? t('approveTitle', { n: st.ordinal }) : t('disputeTitle', { n: st.ordinal })}
      description={
        mode === 'approve'
          ? t('approveIntro', { amount: formatEuros(BigInt(st.periodAmount)) })
          : t('disputeIntro')
      }
      closeLabel={tp('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tp('close')}
          </Button>
          <Button
            variant={mode === 'approve' ? 'accent' : 'danger'}
            loading={busy}
            onClick={() => void submit()}
          >
            {mode === 'approve' ? t('approveSubmit') : t('disputeSubmit')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? <Notice tone="crit">{error}</Notice> : null}
        {mode === 'approve' ? (
          <TextField
            label={t('signerName')}
            value={name}
            autoComplete="name"
            onChange={(e) => setName(e.target.value)}
          />
        ) : (
          <TextAreaField
            label={t('reason')}
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </div>
    </Dialog>
  );
}

/** Vos factures : solde, échéance, communication structurée, paiement en ligne (02 P8). */
export function PortalInvoices({ invoices, base }: { invoices: Invoice[]; base: string }) {
  const t = useTranslations('portalProject.invoices');
  const tp = useTranslations('portal');
  const [paying, setPaying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!invoices.length) return null;
  const pay = async (inv: Invoice) => {
    setPaying(inv.id);
    setError(null);
    try {
      const r = await api<{ url: string }>(`${base}/invoices/${inv.id}/pay`, { body: {} });
      // Page de paiement simulée (mode démo) : retour automatique vers ce portail.
      const url = r.url.includes('/paiement-simule/')
        ? `${r.url}?retour=${encodeURIComponent(window.location.pathname)}`
        : r.url;
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : tp('errors.generic'));
      setPaying(null);
    }
  };
  return (
    <section aria-labelledby="portal-invoices" className="flex flex-col gap-2">
      <h2 id="portal-invoices" className="text-[17px] font-semibold">
        {t('title')}
      </h2>
      {error ? <Notice tone="crit">{error}</Notice> : null}
      <ul className="flex flex-col divide-y divide-line-soft rounded-[16px] border border-line">
        {invoices.map((inv) => (
          <li key={inv.id} className="flex flex-col gap-2 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold">{t('invoice', { number: inv.number })}</p>
                <p className="text-[13px] text-muted">{inv.title}</p>
              </div>
              <Chip tone={inv.balance === 0 ? 'good' : inv.overdue ? 'crit' : 'accent'} dot>
                {inv.balance === 0 ? t('paid') : inv.overdue ? t('overdue') : t('toPay')}
              </Chip>
            </div>
            {inv.balance > 0 ? (
              <p className="text-[14px]">
                {t('due', { amount: formatEuros(BigInt(inv.balance)), date: dayFr(inv.dueDate) })}
                {inv.structuredCommunication ? (
                  <span className="block font-mono text-[13px] text-muted">
                    {inv.structuredCommunication}
                  </span>
                ) : null}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {inv.canPayOnline ? (
                <Button
                  variant="accent"
                  size="sm"
                  loading={paying === inv.id}
                  icon={<CreditCard aria-hidden className="size-4" />}
                  onClick={() => void pay(inv)}
                >
                  {t('payOnline', { amount: formatEuros(BigInt(inv.balance)) })}
                </Button>
              ) : null}
              <a
                href={inv.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-9 items-center gap-1.5 text-[13px] font-medium underline-offset-2 hover:underline"
              >
                <FileText aria-hidden className="size-4" />
                {t('pdf')}
              </a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
