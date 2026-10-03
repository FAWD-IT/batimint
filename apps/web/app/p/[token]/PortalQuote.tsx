'use client';

import type { PortalQuoteDto } from '@batimint/contracts';
import {
  computeQuote,
  formatEuros,
  formatQuantity,
  isSectionIncluded,
  type VatRegime,
} from '@batimint/domain';
import {
  Button,
  buttonClasses,
  Checkbox,
  Chip,
  cn,
  Dialog,
  Notice,
  Skeleton,
  Switch,
  TextField,
} from '@batimint/ui';
import { CheckCircle2, Download, FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { PortalShell } from '@/components/portal/PortalShell';
import { SignaturePad } from '@/components/portal/SignaturePad';
import { api, ApiError } from '@/lib/api';

/**
 * Portail client — devis (02 P2.8) : mobile d'abord, vouvoiement, choix des options avec total
 * en direct, signature et attestation 6 % dans le même flux.
 */
export function PortalQuote({ token }: { token: string }) {
  const t = useTranslations('portal');
  const [data, setData] = useState<PortalQuoteDto | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [options, setOptions] = useState<Record<string, boolean>>({});
  const [signing, setSigning] = useState(false);
  const [terms, setTerms] = useState(false);
  const viewed = useRef(false);

  useEffect(() => {
    let cancelled = false;
    api<PortalQuoteDto>(`/portal/quotes/${encodeURIComponent(token)}`)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setOptions(Object.fromEntries(d.sections.filter((s) => s.optional).map((s) => [s.key, s.selected])));
        if (!viewed.current && d.quote.status === 'sent') {
          viewed.current = true;
          void api(`/portal/quotes/${encodeURIComponent(token)}/view`, {
            body: {},
            idempotencyKey: false,
          }).catch(() => undefined);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? { code: err.code, message: err.message || t('errors.generic') }
            : { code: 'unknown', message: t('errors.generic') },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [token, t]);

  // Total en direct selon les options choisies (mêmes calculs que le devis et le PDF).
  const totals = useMemo(() => {
    if (!data) return null;
    return computeQuote({
      deposit: data.quote.depositPercent
        ? { kind: 'percent', value: data.quote.depositPercent }
        : data.totals.depositAmount > 0
          ? { kind: 'amount', value: BigInt(data.totals.depositAmount) }
          : null,
      sections: data.sections.map((s) => ({
        id: s.key,
        title: s.title,
        optional: s.optional,
        selected: s.optional ? Boolean(options[s.key]) : false,
        lines: s.lines.map((l) => ({
          id: l.key,
          kind: l.kind,
          description: l.description,
          unit: l.unit,
          quantity: l.quantity,
          unitPrice: BigInt(l.unitPrice),
          unitCost: 0n,
          laborHours: '0',
          vatRegime: l.vatRegime as VatRegime,
          discountPercent: l.discountPercent,
        })),
      })),
    });
  }, [data, options]);

  if (error)
    return (
      <PortalShell accent="#111111">
        <div className="flex flex-col gap-3 py-16 text-center">
          <h1 className="text-[22px] font-bold">{t('errors.title')}</h1>
          <p className="text-[15px] text-muted">{error.message}</p>
        </div>
      </PortalShell>
    );
  if (!data || !totals)
    return (
      <PortalShell accent="#111111">
        <div className="flex flex-col gap-4 py-6" aria-busy>
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </PortalShell>
    );

  const q = data.quote;
  const signed = q.status === 'signed';
  const signable = q.status === 'sent' || q.status === 'viewed';
  const certificateNeeded = data.sections.some(
    (s) =>
      isSectionIncluded({ optional: s.optional, selected: Boolean(options[s.key]) }) &&
      s.lines.some((l) => l.kind === 'item' && l.vatRegime === 'reduced_6'),
  );
  const d = totals.document;
  const pdfUrl = `/api/v1/portal/quotes/${encodeURIComponent(token)}/pdf`;

  return (
    <PortalShell accent={data.tenant.accent} tenant={data.tenant} subtitle={q.title}>
      <section className="flex flex-col gap-2 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={signed ? 'good' : signable ? 'accent' : 'crit'} dot>
            {t(`status.${q.status}`)}
          </Chip>
          {q.validUntil && signable ? (
            <span className="text-[13px] text-muted">
              {t('validUntil', {
                date: new Date(q.validUntil).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long' }),
              })}
            </span>
          ) : null}
        </div>
        <h1 className="text-[26px] leading-tight font-bold tracking-[-0.025em]">
          {t('heading', { number: q.number ?? '' })}
        </h1>
        <p className="text-[15px] text-muted">{t('greeting', { name: data.customer.displayName })}</p>
        {q.intro ? <p className="text-[15px] whitespace-pre-line">{q.intro}</p> : null}
        {data.site ? (
          <p className="text-[13px] text-muted">{t('site', { address: data.site.address })}</p>
        ) : null}
      </section>

      {signed ? (
        <section className="flex flex-col gap-3 rounded-[16px] bg-panel p-4 text-white" role="status">
          <CheckCircle2 aria-hidden className="size-7" style={{ color: 'var(--accent)' }} />
          <p className="text-[18px] font-semibold">{t('signed.title')}</p>
          <p className="text-[14px] text-white/80">
            {t('signed.body', {
              name: data.signature?.signerName ?? '',
              date: data.signature ? new Date(data.signature.signedAt).toLocaleString('fr-BE') : '',
            })}
          </p>
          <p className="text-[14px] text-white/80">
            {data.projectCreated ? t('signed.project') : t('signed.next')}
          </p>
          <div className="flex flex-wrap gap-2">
            {data.projectCreated ? <FollowProjectButton token={token} /> : null}
            <a href={pdfUrl} target="_blank" rel="noreferrer" className={buttonClasses('inverse', 'md')}>
              <Download aria-hidden className="size-4" />
              {t('signed.download')}
            </a>
          </div>
        </section>
      ) : !signable ? (
        <Notice tone="warn" title={t(`closed.${q.status}`)}>
          {t('closed.body', { company: data.tenant.name })}
        </Notice>
      ) : null}

      <section className="flex flex-col gap-3" aria-label={t('content')}>
        {data.sections.map((s) => {
          const included = s.optional ? Boolean(options[s.key]) : true;
          const st = totals.sections.find((x) => x.id === s.key);
          return (
            <article
              key={s.key}
              className={cn(
                'flex flex-col gap-2 rounded-[16px] border p-4',
                s.optional
                  ? included
                    ? 'border-[var(--accent)]'
                    : 'border-dashed border-line'
                  : 'border-line',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-[16px] font-semibold">{s.title}</h2>
                <span
                  className={cn('shrink-0 text-[15px] font-semibold tabular-nums', !included && 'text-muted')}
                >
                  {st ? formatEuros(st.netAmount) : ''}
                </span>
              </div>
              {s.description ? <p className="text-[13px] text-muted">{s.description}</p> : null}
              <ul className="flex flex-col divide-y divide-line-soft">
                {s.lines.map((l) => (
                  <li key={l.key} className="flex items-start justify-between gap-3 py-2 text-[14px]">
                    <span className="min-w-0">
                      <span
                        className={cn('block whitespace-pre-line', l.kind === 'text' && 'text-muted italic')}
                      >
                        {l.description}
                      </span>
                      {l.kind === 'item' ? (
                        <span className="block text-[12px] text-muted tabular-nums">
                          {formatQuantity(l.quantity)} {l.unit} × {formatEuros(BigInt(l.unitPrice))}
                          {l.discountPercent !== '0' ? ` · −${formatQuantity(l.discountPercent)} %` : ''}
                        </span>
                      ) : null}
                    </span>
                    {l.kind === 'item' ? (
                      <span className="shrink-0 tabular-nums">
                        {formatEuros(totals.lines.find((x) => x.id === l.key)?.netAmount ?? 0n)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {s.optional ? (
                <div className="rounded-[12px] bg-line-soft/60 px-3">
                  <Switch
                    label={t('option.add', { amount: st ? formatEuros(st.netAmount) : '' })}
                    description={t('option.hint')}
                    checked={included}
                    disabled={!signable}
                    onChange={(v) => setOptions((o) => ({ ...o, [s.key]: v }))}
                  />
                </div>
              ) : null}
            </article>
          );
        })}
      </section>

      <section
        className="flex flex-col gap-1.5 rounded-[16px] border border-line p-4 text-[14px]"
        aria-label={t('totals.title')}
        data-testid="portal-totals"
      >
        <TotalRow label={t('totals.net')} value={formatEuros(d.totalNet)} />
        {d.vatBreakdown.map((v) => (
          <TotalRow
            key={`${v.category}${v.ratePercent}`}
            label={v.category === 'AE' ? t('totals.reverseCharge') : t('totals.vat', { rate: v.ratePercent })}
            value={formatEuros(v.taxAmount)}
            muted
          />
        ))}
        <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2">
          <span className="font-semibold">{t('totals.gross')}</span>
          <span className="text-[22px] font-bold tabular-nums" data-testid="portal-total-gross">
            {formatEuros(d.totalGross)}
          </span>
        </div>
        {totals.depositAmount > 0n ? (
          <TotalRow
            label={t('totals.deposit', { percent: q.depositPercent ?? '' })}
            value={formatEuros(totals.depositAmount)}
          />
        ) : null}
        {d.hasReverseCharge ? (
          <p className="pt-1 text-[12px] text-muted">{t('totals.reverseChargeHint')}</p>
        ) : null}
      </section>

      {q.paymentSchedule.length ? (
        <section className="flex flex-col gap-1 text-[14px]">
          <h2 className="font-semibold">{t('schedule')}</h2>
          <ul>
            {q.paymentSchedule.map((p, i) => (
              <li key={i} className="flex justify-between text-muted">
                <span>{p.label}</span>
                <span className="tabular-nums">{formatQuantity(p.percent)} %</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {q.notes ? <p className="text-[14px] whitespace-pre-line text-muted">{q.notes}</p> : null}

      <div className="flex flex-wrap gap-2">
        <a href={pdfUrl} target="_blank" rel="noreferrer" className={buttonClasses('secondary')}>
          <Download aria-hidden className="size-4" />
          {t('pdf')}
        </a>
        {data.tenant.termsAndConditions ? (
          <Button
            variant="ghost"
            icon={<FileText aria-hidden className="size-4" />}
            onClick={() => setTerms(true)}
          >
            {t('terms')}
          </Button>
        ) : null}
      </div>

      {signable ? (
        <div className="sticky bottom-0 -mx-5 mt-2 flex items-center justify-between gap-3 border-t border-line bg-surface/95 px-5 py-3 backdrop-blur">
          <span className="flex flex-col">
            <span className="text-[12px] text-muted">{t('totals.gross')}</span>
            <span className="text-[18px] font-bold tabular-nums">{formatEuros(d.totalGross)}</span>
          </span>
          <Button variant="accent" size="lg" onClick={() => setSigning(true)}>
            {t('signCta')}
          </Button>
        </div>
      ) : null}

      {signing ? (
        <SignDialog
          token={token}
          data={data}
          options={options}
          certificateNeeded={certificateNeeded}
          onClose={() => setSigning(false)}
          onSigned={(next) => {
            setData(next);
            setSigning(false);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      ) : null}
      {terms ? (
        <Dialog open onClose={() => setTerms(false)} title={t('terms')} closeLabel={t('close')}>
          <p className="text-[14px] whitespace-pre-line">{data.tenant.termsAndConditions}</p>
        </Dialog>
      ) : null}
    </PortalShell>
  );
}

function SignDialog({
  token,
  data,
  options,
  certificateNeeded,
  onClose,
  onSigned,
}: {
  token: string;
  data: PortalQuoteDto;
  options: Record<string, boolean>;
  certificateNeeded: boolean;
  onClose: () => void;
  onSigned: (d: PortalQuoteDto) => void;
}) {
  const t = useTranslations('portal.sign');
  const [name, setName] = useState(data.customer.displayName);
  const [accept, setAccept] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [year, setYear] = useState(data.site?.firstOccupancyYear ? String(data.site.firstOccupancyYear) : '');
  const [decl, setDecl] = useState({ privateDwelling: false, overTenYears: false, finalConsumer: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (name.trim().length < 2) errs['name'] = t('nameRequired');
    if (!accept) errs['accept'] = t('acceptRequired');
    if (certificateNeeded) {
      const y = Number.parseInt(year, 10);
      if (!y || y < 1700 || y > new Date().getFullYear()) errs['year'] = t('yearRequired');
      if (!decl.privateDwelling || !decl.overTenYears || !decl.finalConsumer)
        errs['decl'] = t('declarationsRequired');
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setServerError(null);
    try {
      const next = await api<PortalQuoteDto>(`/portal/quotes/${encodeURIComponent(token)}/sign`, {
        body: {
          signerName: name.trim(),
          acceptTerms: true,
          signaturePath: path,
          options,
          certificate: certificateNeeded
            ? {
                firstOccupancyYear: Number.parseInt(year, 10),
                privateDwelling: true,
                overTenYears: true,
                finalConsumer: true,
              }
            : null,
        },
      });
      onSigned(next);
    } catch (err) {
      setServerError(err instanceof ApiError && err.message ? err.message : t('error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title')}
      description={t('description', { number: data.quote.number ?? '' })}
      closeLabel={t('close')}
      className="w-[min(100vw,560px)]"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="submit" form="sign-form" variant="accent" loading={busy}>
            {t('submit')}
          </Button>
        </>
      }
    >
      <form id="sign-form" noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        {serverError ? <Notice tone="crit">{serverError}</Notice> : null}
        {certificateNeeded ? (
          <fieldset className="flex flex-col gap-2 rounded-[12px] border border-line p-3">
            <legend className="px-1 text-[14px] font-semibold">{t('certificate.title')}</legend>
            <p className="text-[13px] text-muted">
              {t('certificate.intro', { address: data.site?.address ?? '' })}
            </p>
            <TextField
              label={t('certificate.year')}
              value={year}
              inputMode="numeric"
              maxLength={4}
              onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))}
              error={errors['year']}
              containerClassName="max-w-48"
            />
            <Checkbox
              label={t('certificate.privateDwelling')}
              checked={decl.privateDwelling}
              onChange={(e) => setDecl({ ...decl, privateDwelling: e.target.checked })}
            />
            <Checkbox
              label={t('certificate.overTenYears')}
              checked={decl.overTenYears}
              onChange={(e) => setDecl({ ...decl, overTenYears: e.target.checked })}
            />
            <Checkbox
              label={t('certificate.finalConsumer')}
              checked={decl.finalConsumer}
              onChange={(e) => setDecl({ ...decl, finalConsumer: e.target.checked })}
            />
            {errors['decl'] ? (
              <p role="alert" className="text-[13px] text-crit">
                {errors['decl']}
              </p>
            ) : null}
            <p className="text-[12px] text-muted">{t('certificate.warning')}</p>
          </fieldset>
        ) : null}
        <TextField
          label={t('name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors['name']}
          autoComplete="name"
        />
        <SignaturePad onChange={setPath} />
        <div>
          <Checkbox label={t('accept')} checked={accept} onChange={(e) => setAccept(e.target.checked)} />
          {errors['accept'] ? (
            <p role="alert" className="text-[13px] text-crit">
              {errors['accept']}
            </p>
          ) : null}
        </div>
        <p className="text-[12px] text-muted">{t('legal')}</p>
      </form>
    </Dialog>
  );
}

function TotalRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3', muted && 'text-muted')}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/** Après la signature : un lien de suivi du chantier est créé pour ce client, puis ouvert. */
function FollowProjectButton({ token }: { token: string }) {
  const t = useTranslations('portal');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="accent"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setFailed(null);
          try {
            const r = await api<{ url: string }>(`/portal/quotes/${encodeURIComponent(token)}/project-link`, {
              body: {},
            });
            window.location.assign(new URL(r.url).pathname);
          } catch (err) {
            setFailed(err instanceof ApiError && err.message ? err.message : t('errors.generic'));
            setBusy(false);
          }
        }}
      >
        {t('signed.follow')}
      </Button>
      {failed ? <p className="w-full text-[13px] text-white/80">{failed}</p> : null}
    </>
  );
}
