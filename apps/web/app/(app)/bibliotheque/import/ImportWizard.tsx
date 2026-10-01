'use client';

import { IMPORT_FIELDS, type ImportField, REQUIRED_IMPORT_FIELDS } from '@batimint/domain';
import {
  Button,
  buttonClasses,
  Card,
  ErrorState,
  Notice,
  PageHeader,
  SelectField,
  StepBar,
  Table,
  Td,
  Th,
} from '@batimint/ui';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileSpreadsheet } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { TRADES } from '@/components/crm/OpportunityDialog';
import { api } from '@/lib/api';
import { useCan } from '@/lib/session';
import { uploadRaw } from '@/lib/upload';
import { useErrorMessage } from '@/lib/use-error-message';

interface Preview {
  fileId: string;
  fileName: string;
  headers: string[];
  sampleRows: string[][];
  totalRows: number;
  suggestedMapping: Partial<Record<ImportField, number>>;
}

interface Report {
  dryRun: boolean;
  created: number;
  updated: number;
  unchanged: number;
  errors: { row: number; field: string | null; message: string }[];
  durationMs: number;
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Import Excel/CSV en trois étapes (P1.4) : fichier, colonnes, résultat. */
export function ImportWizard() {
  const t = useTranslations('import');
  const tl = useTranslations('library');
  const tc = useTranslations('common');
  const can = useCan();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<ImportField, number>>>({});
  const [trade, setTrade] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState<'analyze' | 'check' | 'run' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!can('library.write'))
    return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;

  const step = report && !report.dryRun ? 2 : preview ? 1 : 0;
  const missing = REQUIRED_IMPORT_FIELDS.filter((f) => mapping[f] === undefined);

  const analyze = async (file: File) => {
    setBusy('analyze');
    setError(null);
    setReport(null);
    try {
      const isXlsx = /\.xlsx$/i.test(file.name) || file.type === XLSX;
      const p = await uploadRaw<Preview>('/library/import/preview', file, {
        fileName: file.name,
        contentType: isXlsx ? XLSX : 'text/csv',
      });
      setPreview(p);
      setMapping(p.suggestedMapping);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const run = async (dryRun: boolean) => {
    if (!preview) return;
    if (missing.length) return setError(t('missingRequired'));
    setBusy(dryRun ? 'check' : 'run');
    setError(null);
    try {
      const r = await api<Report>('/library/import', {
        body: { fileId: preview.fileId, mapping, dryRun, trade: trade || null },
      });
      setReport(r);
      if (!dryRun) void queryClient.invalidateQueries({ queryKey: ['items'] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const reset = () => {
    setPreview(null);
    setMapping({});
    setReport(null);
    setError(null);
  };

  const mappedFields = IMPORT_FIELDS.filter((f) => mapping[f] !== undefined);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        breadcrumb={
          <Link href="/bibliotheque" className="hover:underline">
            {tl('title')}
          </Link>
        }
        title={t('title')}
      />
      <StepBar label={t('title')} steps={[t('step1'), t('step2'), t('step3')]} current={step} progress={1} />
      {error ? <Notice tone="crit">{error}</Notice> : null}

      {step === 0 ? (
        <Card className="flex flex-col items-start gap-4">
          <FileSpreadsheet aria-hidden className="size-8 text-muted" />
          <p className="text-[14px] text-muted">{t('hint')}</p>
          <Button
            size="lg"
            loading={busy === 'analyze'}
            loadingLabel={t('analyzing')}
            onClick={() => input.current?.click()}
          >
            {t('choose')}
          </Button>
          <input
            ref={input}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            data-testid="import-file"
            aria-label={t('choose')}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void analyze(f);
              e.target.value = '';
            }}
          />
        </Card>
      ) : null}

      {step === 1 && preview ? (
        <>
          <Card className="flex flex-col gap-4">
            <div>
              <h2 className="text-[17px] font-semibold">{t('mapping')}</h2>
              <p className="text-[14px] text-muted">
                {t('rows', { count: preview.totalRows, file: preview.fileName })} {t('mappingHint')}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {IMPORT_FIELDS.map((f) => {
                const required = REQUIRED_IMPORT_FIELDS.includes(f);
                return (
                  <SelectField
                    key={f}
                    label={`${t(`fields.${f}`)}${required ? ` (${t('required')})` : ''}`}
                    value={mapping[f] === undefined ? '' : String(mapping[f])}
                    error={required && mapping[f] === undefined && error ? t('requiredField') : null}
                    onChange={(e) =>
                      setMapping((m) => {
                        const next = { ...m };
                        if (e.target.value === '') delete next[f];
                        else next[f] = Number(e.target.value);
                        return next;
                      })
                    }
                    options={[
                      { value: '', label: t('ignore') },
                      ...preview.headers.map((h, i) => ({ value: String(i), label: h })),
                    ]}
                  />
                );
              })}
              <SelectField
                label={t('defaultTrade')}
                value={trade}
                onChange={(e) => setTrade(e.target.value)}
                options={[
                  { value: '', label: tc('none') },
                  ...TRADES.map((x) => ({ value: x, label: tl(`trades.${x}`) })),
                ]}
              />
            </div>
          </Card>
          {mappedFields.length ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-[15px] font-semibold">{t('preview')}</h2>
              <Table label={t('preview')}>
                <thead>
                  <tr>
                    {mappedFields.map((f) => (
                      <Th key={f}>{t(`fields.${f}`)}</Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sampleRows.slice(0, 5).map((row, i) => (
                    <tr key={i}>
                      {mappedFields.map((f) => (
                        <Td key={f} className="max-w-60 truncate">
                          {row[mapping[f]!] ?? ''}
                        </Td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Table>
            </section>
          ) : null}
          {report?.dryRun ? (
            <Notice tone={report.errors.length ? 'warn' : 'good'}>
              {t('simulation', {
                created: report.created,
                updated: report.updated,
                unchanged: report.unchanged,
                errors: report.errors.length,
              })}
            </Notice>
          ) : null}
          {report?.dryRun && report.errors.length ? <ErrorTable errors={report.errors} /> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={reset}>
              {tc('back')}
            </Button>
            <Button variant="secondary" loading={busy === 'check'} onClick={() => void run(true)}>
              {t('simulate')}
            </Button>
            <Button loading={busy === 'run'} onClick={() => void run(false)}>
              {t('run')}
            </Button>
          </div>
        </>
      ) : null}

      {step === 2 && report ? (
        <>
          <Card className="flex flex-col gap-4">
            <p className="flex items-center gap-2 text-[17px] font-semibold">
              <CheckCircle2 aria-hidden className="size-5 text-good" />
              {t('done', { seconds: (report.durationMs / 1000).toFixed(1).replace('.', ',') })}
            </p>
            <dl className="grid grid-cols-3 gap-3">
              {(['created', 'updated', 'unchanged'] as const).map((k) => (
                <div key={k} className="rounded-[12px] bg-line-soft/60 p-3">
                  <dt className="text-[13px] text-muted">{t(k)}</dt>
                  <dd className="text-[24px] font-semibold tabular-nums">{report[k]}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <section className="flex flex-col gap-2">
            <h2 className="text-[15px] font-semibold">
              {t('errors')} · {report.errors.length}
            </h2>
            {report.errors.length ? (
              <ErrorTable errors={report.errors} />
            ) : (
              <p className="text-[14px] text-muted">{t('noErrors')}</p>
            )}
          </section>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={reset}>
              {t('again')}
            </Button>
            <Link href="/bibliotheque" className={buttonClasses('primary')}>
              {t('back')}
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ErrorTable({ errors }: { errors: Report['errors'] }) {
  const t = useTranslations('import');
  return (
    <Table label={t('errors')} className="max-h-96 overflow-y-auto">
      <thead>
        <tr>
          <Th>{t('row')}</Th>
          <Th>{t('field')}</Th>
          <Th>{t('message')}</Th>
        </tr>
      </thead>
      <tbody>
        {errors.slice(0, 200).map((e, i) => (
          <tr key={i}>
            <Td className="tabular-nums">{e.row}</Td>
            <Td>
              {e.field
                ? IMPORT_FIELDS.includes(e.field as ImportField)
                  ? t(`fields.${e.field}`)
                  : e.field
                : '—'}
            </Td>
            <Td>{e.message}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
