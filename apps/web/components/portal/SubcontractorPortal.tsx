'use client';

import type { PortalSubcontractorDto, SubcontractorDocumentKind } from '@batimint/contracts';
import { formatEuros } from '@batimint/domain';
import {
  Button,
  buttonClasses,
  Card,
  Chip,
  Dialog,
  Notice,
  SelectField,
  Skeleton,
  TextField,
  useToast,
} from '@batimint/ui';
import { ExternalLink, FileUp, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { MoneyInput } from '@/components/MoneyInput';
import { DocumentUploadDialog } from '@/components/subcontracting/DocumentUploadDialog';
import { DOC_STATUS_TONE, formatDay } from '@/components/subcontracting/shared';
import { api, ApiError } from '@/lib/api';
import { uploadRaw } from '@/lib/upload';
import { useErrorMessage } from '@/lib/use-error-message';
import { PortalShell } from './PortalShell';

const STATE_TONE = { received: 'neutral', processing: 'accent', approved: 'accent', paid: 'good' } as const;

/**
 * Portail sous-traitant (03 §9, P9.2) : vos missions, les documents à fournir, le dépôt de vos
 * factures et leur suivi. Vouvoiement.
 */
export function SubcontractorPortal({ token }: { token: string }) {
  const t = useTranslations('portalSubcontractor');
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'ready'; data: PortalSubcontractorDto } | { kind: 'error'; message: string }
  >({ kind: 'loading' });
  const base = `/portal/subcontractors/${encodeURIComponent(token)}`;
  const load = useCallback(() => {
    api<PortalSubcontractorDto>(base)
      .then((data) => setState({ kind: 'ready', data }))
      .catch((err) =>
        setState({
          kind: 'error',
          message: err instanceof ApiError && err.message ? err.message : t('errors.generic'),
        }),
      );
  }, [base, t]);
  useEffect(() => load(), [load]);

  if (state.kind !== 'ready')
    return (
      <PortalShell accent="#111111">
        {state.kind === 'error' ? (
          <div className="flex flex-col gap-3 py-16 text-center">
            <h1 className="text-[22px] font-bold">{t('errors.title')}</h1>
            <p className="text-[15px] text-muted">{state.message}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-6" aria-busy>
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        )}
      </PortalShell>
    );
  return <Portal data={state.data} base={base} onChange={(d) => setState({ kind: 'ready', data: d })} />;
}

function Portal({
  data: d,
  base,
  onChange,
}: {
  data: PortalSubcontractorDto;
  base: string;
  onChange: (d: PortalSubcontractorDto) => void;
}) {
  const t = useTranslations('portalSubcontractor');
  const tk = useTranslations('subcontracting.documentKinds');
  const ts = useTranslations('subcontracting.documentStatus');
  const [upload, setUpload] = useState<{ kind?: SubcontractorDocumentKind } | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<string | null>(null);
  const contact = d.missions.find((m) => m.contact)?.contact ?? null;
  const toFix = d.compliance.requirements.filter((r) => r.status !== 'valid');
  const active = d.missions.filter((m) => m.status === 'active');
  return (
    <PortalShell
      accent={d.tenant.accent}
      tenant={d.tenant}
      subtitle={t('subtitle', { name: d.subcontractor.name })}
      contact={contact ? { ...contact, email: d.tenant.email } : null}
    >
      <h1 className="text-[24px] leading-tight font-bold tracking-[-0.02em]">
        {t('hello', { name: d.subcontractor.name })}
      </h1>
      <p className="text-[15px] text-muted">{t('intro', { tenant: d.tenant.name })}</p>

      {toFix.length ? (
        <Notice
          tone={d.compliance.compliant ? 'warn' : 'crit'}
          title={t('documentsToProvide', { n: toFix.length })}
        >
          {t('documentsHelp')}
        </Notice>
      ) : null}

      <section aria-labelledby="missions" className="flex flex-col gap-3">
        <h2 id="missions" className="text-[17px] font-semibold">
          {t('missions')}
        </h2>
        {d.missions.length === 0 ? (
          <p className="text-[14px] text-muted">{t('noMissions')}</p>
        ) : (
          d.missions.map((m) => (
            <Card key={m.id} className="flex flex-col gap-3 p-4" data-testid="portal-mission">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                  <h3 className="font-semibold">{m.title}</h3>
                  <p className="text-[13px] text-muted">
                    {m.project.name}
                    {m.project.address ? ` · ${m.project.address}` : ''}
                  </p>
                </div>
                <Chip tone={m.status === 'active' ? 'accent' : 'good'} dot>
                  {t(`missionStatus.${m.status}`)}
                </Chip>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-[14px]">
                <div>
                  <dt className="text-[12px] text-muted">{t('dates')}</dt>
                  <dd>
                    {m.startDate
                      ? `${formatDay(m.startDate)} → ${formatDay(m.endDate)}`
                      : t('datesToConfirm')}
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">{t('amount')}</dt>
                  <dd className="tabular-nums">{formatEuros(BigInt(m.amount))}</dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">{t('invoiced')}</dt>
                  <dd className="tabular-nums">{formatEuros(BigInt(m.invoiced))}</dd>
                </div>
                <div>
                  <dt className="text-[12px] text-muted">{t('number')}</dt>
                  <dd className="font-mono text-[13px]">{m.number}</dd>
                </div>
              </dl>
              {m.scope ? <p className="text-[14px] whitespace-pre-line">{m.scope}</p> : null}
              {m.installments.length > 1 ? (
                <ul className="flex flex-col gap-1 text-[13px]">
                  {m.installments.map((i, k) => (
                    <li key={k} className="flex justify-between gap-2">
                      <span>
                        {i.label} · {i.percent.replace('.', ',')} %{i.dueOn ? ` · ${formatDay(i.dueOn)}` : ''}
                      </span>
                      <span className="tabular-nums">{formatEuros(BigInt(i.amount))}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <a
                  href={m.pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonClasses('secondary', 'sm')}
                >
                  <ExternalLink aria-hidden className="size-4" />
                  {t('contract')}
                </a>
                {m.status === 'active' ? (
                  <Button
                    size="sm"
                    icon={<Upload aria-hidden className="size-4" />}
                    onClick={() => setInvoiceFor(m.id)}
                  >
                    {t('sendInvoice')}
                  </Button>
                ) : null}
              </div>
            </Card>
          ))
        )}
      </section>

      <section aria-labelledby="documents" className="flex flex-col gap-3">
        <h2 id="documents" className="text-[17px] font-semibold">
          {t('documents')}
        </h2>
        <ul className="flex flex-col divide-y divide-line-soft rounded-[14px] border border-line">
          {d.compliance.requirements.map((r) => (
            <li key={r.kind} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span className="flex flex-col">
                <span className="text-[14px] font-medium">{tk(r.kind)}</span>
                <span className="text-[12px] text-muted">
                  {r.status === 'missing'
                    ? t('missing')
                    : r.expiresOn
                      ? t(r.status === 'expired' ? 'expiredOn' : 'until', { date: formatDay(r.expiresOn) })
                      : t('noExpiry')}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Chip tone={DOC_STATUS_TONE[r.status] ?? 'neutral'} dot>
                  {ts(r.status)}
                </Chip>
                {r.status !== 'valid' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<FileUp aria-hidden className="size-4" />}
                    aria-label={t('uploadKind', { kind: tk(r.kind) })}
                    onClick={() => setUpload({ kind: r.kind })}
                  >
                    {t('upload')}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        <Button
          variant="secondary"
          size="sm"
          className="w-fit"
          icon={<FileUp aria-hidden className="size-4" />}
          onClick={() => setUpload({})}
        >
          {t('uploadOther')}
        </Button>
      </section>

      <section aria-labelledby="invoices" className="flex flex-col gap-3">
        <h2 id="invoices" className="text-[17px] font-semibold">
          {t('invoices')}
        </h2>
        {d.invoices.length === 0 ? (
          <p className="text-[14px] text-muted">
            {active.length ? t('noInvoices') : t('noInvoicesNoMission')}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-soft rounded-[14px] border border-line">
            {d.invoices.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[14px]"
              >
                <span className="flex flex-col">
                  <span className="font-medium">
                    {i.number ?? t('invoiceNoNumber')}
                    {i.missionNumber ? (
                      <span className="font-normal text-muted"> · {i.missionNumber}</span>
                    ) : null}
                  </span>
                  <span className="text-[12px] text-muted">
                    {t('receivedOn', { date: formatDay(i.receivedAt) })}
                    {i.paidAt ? ` · ${t('paidOn', { date: formatDay(i.paidAt) })}` : ''}
                  </span>
                  {i.withholding ? (
                    <span className="text-[12px] text-muted">
                      {t('withheld', { amount: formatEuros(BigInt(i.withholding)) })}
                    </span>
                  ) : null}
                </span>
                <span className="flex items-center gap-2">
                  {i.totalGross ? (
                    <span className="tabular-nums">{formatEuros(BigInt(i.totalGross))}</span>
                  ) : null}
                  <Chip tone={STATE_TONE[i.state]} dot>
                    {t(`invoiceState.${i.state}`)}
                  </Chip>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {upload ? (
        <DocumentUploadDialog
          path={`${base}/documents`}
          kind={upload.kind}
          vouvoiement
          onClose={() => setUpload(null)}
          onUploaded={(r) => {
            setUpload(null);
            onChange(r as PortalSubcontractorDto);
          }}
        />
      ) : null}
      {invoiceFor ? (
        <InvoiceUploadDialog
          base={base}
          missions={active}
          missionId={invoiceFor}
          onClose={() => setInvoiceFor(null)}
          onUploaded={(r) => {
            setInvoiceFor(null);
            onChange(r);
          }}
        />
      ) : null}
    </PortalShell>
  );
}

function InvoiceUploadDialog({
  base,
  missions,
  missionId,
  onClose,
  onUploaded,
}: {
  base: string;
  missions: PortalSubcontractorDto['missions'];
  missionId: string;
  onClose: () => void;
  onUploaded: (d: PortalSubcontractorDto) => void;
}) {
  const t = useTranslations('portalSubcontractor.invoiceDialog');
  const tc = useTranslations('common');
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const fileId = useId();
  const [id] = useState(() => uuidv7());
  const [mission, setMission] = useState(missionId);
  const [file, setFile] = useState<File | null>(null);
  const [number, setNumber] = useState('');
  const [net, setNet] = useState(0);
  const [vat, setVat] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Un fichier UBL porte déjà son numéro et ses montants ; un PDF demande de les indiquer.
  const isXml = Boolean(file && (/xml/.test(file.type) || /\.xml$/i.test(file.name)));
  const submit = async () => {
    if (!file) return setError(t('errors.file'));
    if (file.size > 15 * 1024 * 1024) return setError(t('errors.tooLarge'));
    if (!isXml && !number.trim()) return setError(t('errors.number'));
    if (!isXml && net <= 0) return setError(t('errors.amount'));
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ id, subcontractId: mission });
      if (!isXml) {
        qs.set('number', number.trim());
        qs.set('net', String(net));
        qs.set('vat', String(vat));
      }
      const r = await uploadRaw<PortalSubcontractorDto>(`${base}/invoices?${qs.toString()}`, file, {
        fileName: file.name,
      });
      toast.show({ title: t('sent'), tone: 'good' });
      onUploaded(r);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title')}
      description={t('description')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            {t('send')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <SelectField
          label={t('mission')}
          value={mission}
          onChange={(e) => setMission(e.target.value)}
          options={missions.map((m) => ({ value: m.id, label: `${m.number} — ${m.title}` }))}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={fileId} className="text-[13px] font-semibold">
            {t('file')}
          </label>
          <input
            id={fileId}
            type="file"
            accept="application/pdf,application/xml,text/xml,.xml,image/jpeg,image/png"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="min-h-11 rounded-[10px] border border-line bg-surface px-3 py-2 text-[14px] file:mr-3 file:rounded-[8px] file:border-0 file:bg-line-soft file:px-3 file:py-1.5 file:font-medium focus-visible:outline-2 focus-visible:outline-accent"
          />
          <p className="text-[13px] text-muted">{t('fileHint')}</p>
        </div>
        {file && !isXml ? (
          <>
            <TextField label={t('number')} value={number} onChange={(e) => setNumber(e.target.value)} />
            <div className="grid gap-4 sm:grid-cols-2">
              <MoneyInput label={t('net')} cents={net} onChange={setNet} />
              <MoneyInput label={t('vat')} cents={vat} onChange={setVat} hint={t('vatHint')} />
            </div>
          </>
        ) : null}
        {error ? (
          <p role="alert" className="text-[14px] text-crit">
            {error}
          </p>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
