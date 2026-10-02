'use client';

import type { QuoteDto } from '@batimint/contracts';
import { formatEuros, type VatRegime } from '@batimint/domain';
import {
  Button,
  buttonClasses,
  Card,
  CardTitle,
  Chip,
  ConfirmDialog,
  ErrorState,
  Notice,
  PageHeader,
  Skeleton,
  TextAreaField,
  useToast,
} from '@batimint/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, FileDown, GitCompare, Mic, Plus, Save, Send } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CompareDialog,
  DictationDialog,
  type Proposal,
  RefuseDialog,
  SendDialog,
  VatJustificationDialog,
} from '@/components/quotes/Dialogs';
import {
  contentBody,
  docFromQuote,
  type EditDoc,
  type EditSection,
  itemSuggestion,
  move,
  newLine,
  newSection,
  totalsOf,
} from '@/components/quotes/quote-state';
import { QUOTE_STATUS_TONES } from '@/components/quotes/status';
import { SectionCard } from '@/components/quotes/SectionCard';
import { TotalsPanel } from '@/components/quotes/TotalsPanel';
import { VisitPanel } from '@/components/quotes/VisitPanel';
import { api, ApiError } from '@/lib/api';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { useRelativeTime } from '@/lib/use-relative-time';

type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';
type DialogState =
  | { kind: 'send' }
  | { kind: 'dictation' }
  | { kind: 'compare' }
  | { kind: 'refuse' }
  | { kind: 'archive' }
  | { kind: 'vat'; sectionKey: string; lineKey: string; regime: VatRegime; suggested: VatRegime }
  | null;

const AUTOSAVE_MS = 800;

export function QuoteEditor({ id }: { id: string }) {
  const t = useTranslations('quotes');
  const tc = useTranslations('common');
  const can = useCan();
  const toast = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const relative = useRelativeTime();
  const query = useApi<QuoteDto>(['quotes', id], `/quotes/${id}`);
  const [server, setServer] = useState<QuoteDto | null>(null);
  const [doc, setDoc] = useState<EditDoc | null>(null);
  const [revision, setRevision] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const editCounter = useRef(0);
  const saving = useRef<Promise<QuoteDto | null> | null>(null);
  const showCosts = can('pricing.read');

  // Les données du serveur remplacent l'état local seulement quand il n'y a rien en cours.
  useEffect(() => {
    const q = query.data;
    if (!q) return;
    if (!server || q.currentVersion.id !== server.currentVersion.id || saveState === 'saved') {
      setServer(q);
      if (!doc || saveState === 'saved' || q.currentVersion.id !== server?.currentVersion.id) {
        setDoc(docFromQuote(q));
        setRevision(q.currentVersion.revision);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  const readOnly = !server || server.status === 'signed' || !can('quotes.write');
  const totals = useMemo(() => (doc ? totalsOf(doc) : null), [doc]);

  const edit = useCallback(
    (fn: (d: EditDoc) => EditDoc) => {
      if (readOnly) return;
      editCounter.current += 1;
      setDoc((d) => (d ? fn(d) : d));
      setSaveState('dirty');
    },
    [readOnly],
  );

  const save = useCallback(async (): Promise<QuoteDto | null> => {
    if (!doc || !server) return null;
    const started = editCounter.current;
    setSaveState('saving');
    const run = (async () => {
      try {
        const q = await api<QuoteDto>(`/quotes/${id}/content`, {
          method: 'PUT',
          body: contentBody(doc, revision),
          idempotencyKey: false,
        });
        if (q.currentVersion.version !== server.currentVersion.version)
          toast.show({ title: t('editor.newVersion', { n: q.currentVersion.version }), tone: 'accent' });
        setServer(q);
        setRevision(q.currentVersion.revision);
        // Propositions de TVA recalculées par le serveur.
        const suggested = new Map(
          q.currentVersion.sections.flatMap((s) => s.lines.map((l) => [l.key, l.vatSuggested])),
        );
        setDoc((d) =>
          d
            ? {
                ...d,
                sections: d.sections.map((s) => ({
                  ...s,
                  lines: s.lines.map((l) => ({
                    ...l,
                    vatSuggested: (suggested.get(l.key) as VatRegime) ?? l.vatSuggested,
                  })),
                })),
              }
            : d,
        );
        queryClient.setQueryData(['quotes', id], q);
        void queryClient.invalidateQueries({ queryKey: ['quotes'], exact: false, refetchType: 'none' });
        setSaveError(null);
        setSaveState(editCounter.current === started ? 'saved' : 'dirty');
        return q;
      } catch (err) {
        if (err instanceof ApiError && err.code === 'stale_revision') setSaveState('conflict');
        else {
          setSaveError(errorMessage(err));
          setSaveState('error');
        }
        return null;
      } finally {
        saving.current = null;
      }
    })();
    saving.current = run;
    return run;
  }, [doc, server, revision, id, queryClient, toast, t, errorMessage]);

  // Enregistrement automatique après une courte pause.
  useEffect(() => {
    if (saveState !== 'dirty') return;
    const timer = setTimeout(() => {
      if (!saving.current) void save();
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [saveState, doc, save]);

  // Quitter la page avec des modifications non enregistrées : le navigateur prévient.
  useEffect(() => {
    if (saveState !== 'dirty' && saveState !== 'saving') return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [saveState]);

  const flush = async () => {
    if (saving.current) await saving.current;
    if (saveState === 'dirty') return save();
    return server;
  };

  const duplicate = useApiMutation<{ template: boolean }, QuoteDto>(
    ({ template }) => ({
      path: '/quotes',
      body: template
        ? { title: `${server?.title ?? ''}`, fromQuoteId: id, isTemplate: true }
        : {
            title: server?.title ?? '',
            fromQuoteId: id,
            opportunityId: server?.opportunityId ?? null,
            customerId: server?.customer?.id ?? null,
            siteId: server?.site?.id ?? null,
          },
    }),
    {
      invalidate: [['quotes']],
      successMessage: (_q, v) => (v.template ? t('editor.templateSaved') : t('editor.duplicated')),
      onSuccess: (q, v) => {
        if (!v.template) router.push(`/devis/${q.id}`);
      },
    },
  );
  const archive = useApiMutation<void>(() => ({ path: `/quotes/${id}`, method: 'DELETE' }), {
    invalidate: [['quotes']],
    successMessage: t('editor.archived'),
    onSuccess: () => router.replace('/devis'),
  });

  if (query.error && !server) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <ErrorState
        title={missing ? t('notFound') : tc('errorTitle')}
        description={missing ? undefined : errorMessage(query.error)}
        action={
          missing ? (
            <Link href="/devis" className="font-semibold underline">
              {tc('back')}
            </Link>
          ) : (
            <Button onClick={() => void query.refetch()}>{tc('retry')}</Button>
          )
        }
      />
    );
  }
  if (!server || !doc || !totals)
    return (
      <div className="mx-auto flex max-w-7xl flex-col gap-6" aria-busy>
        <Skeleton className="h-12 w-96" />
        <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
          <Skeleton className="h-[480px]" />
          <Skeleton className="h-[480px]" />
        </div>
      </div>
    );

  const q = server;
  const quoteRegime = q.vatSuggestion.regime as VatRegime;
  const sent = ['sent', 'viewed', 'refused', 'expired'].includes(q.currentVersion.status);
  const setSection = (key: string, next: EditSection) =>
    edit((d) => ({ ...d, sections: d.sections.map((s) => (s.key === key ? next : s)) }));

  const onVatChange = (sectionKey: string, lineKey: string, regime: VatRegime) => {
    const line = doc.sections.find((s) => s.key === sectionKey)?.lines.find((l) => l.key === lineKey);
    if (!line) return;
    if (regime === line.vatSuggested) {
      setSection(sectionKey, {
        ...doc.sections.find((s) => s.key === sectionKey)!,
        lines: doc.sections
          .find((s) => s.key === sectionKey)!
          .lines.map((l) => (l.key === lineKey ? { ...l, vatRegime: regime, vatJustification: null } : l)),
      });
    } else setDialog({ kind: 'vat', sectionKey, lineKey, regime, suggested: line.vatSuggested });
  };

  const addProposals = (sectionKey: string, proposals: Proposal[]) =>
    edit((d) => ({
      ...d,
      sections: d.sections.map((s) =>
        s.key !== sectionKey
          ? s
          : {
              ...s,
              lines: [
                ...s.lines,
                ...proposals.map((p) =>
                  p.item
                    ? newLine(itemSuggestion(p.item.vatRate, quoteRegime), {
                        itemId: p.item.id,
                        code: p.item.code,
                        description: p.item.name,
                        unit: p.item.unit,
                        quantity: p.quantity.replace('.', ','),
                        unitPrice: p.item.salePrice,
                        unitCost: p.item.purchasePrice ?? 0,
                        laborHours: p.item.laborHours,
                      })
                    : newLine(quoteRegime, {
                        description: p.description,
                        unit: p.unit,
                        quantity: p.quantity.replace('.', ','),
                      }),
                ),
              ],
            },
      ),
    }));

  const statusLabel = (
    <span className="flex flex-wrap items-center gap-2">
      <Chip tone={QUOTE_STATUS_TONES[q.status]} dot>
        {t(`status.${q.status}`)}
      </Chip>
      {q.isTemplate ? (
        <Chip>{t('template')}</Chip>
      ) : (
        <Chip>{t('versionN', { n: q.currentVersion.version })}</Chip>
      )}
      {q.customer ? (
        <Link href={`/clients/${q.customer.id}`} className="font-medium text-ink hover:underline">
          {q.customer.displayName}
        </Link>
      ) : null}
      <SaveIndicator state={saveState} onRetry={() => void save()} />
    </span>
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader
        breadcrumb={
          <span className="flex items-center gap-2">
            <Link href="/devis" className="hover:underline">
              {t('title')}
            </Link>
            {q.opportunityId ? (
              <>
                <span aria-hidden>·</span>
                <Link href={`/opportunites/${q.opportunityId}`} className="hover:underline">
                  {t('editor.opportunity')}
                </Link>
              </>
            ) : null}
          </span>
        }
        title={
          <span className="flex flex-wrap items-baseline gap-x-3">
            {q.number ? <span className="text-muted tabular-nums">{q.number}</span> : null}
            <input
              aria-label={t('editor.titleLabel')}
              value={doc.title}
              disabled={readOnly}
              onChange={(e) => edit((d) => ({ ...d, title: e.target.value }))}
              className="min-w-[12rem] flex-1 rounded-[8px] border border-transparent bg-transparent hover:border-line focus-visible:border-accent focus-visible:outline-none disabled:hover:border-transparent"
            />
          </span>
        }
        description={statusLabel}
        actions={
          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/v1/quotes/${q.id}/pdf`}
              target="_blank"
              rel="noreferrer"
              className={buttonClasses('secondary')}
            >
              <FileDown aria-hidden className="size-4" />
              {t('editor.pdf')}
            </a>
            {!readOnly ? (
              <Button
                variant="secondary"
                icon={<Mic aria-hidden className="size-4" />}
                onClick={() => setDialog({ kind: 'dictation' })}
              >
                {t('editor.dictate')}
              </Button>
            ) : null}
            {can('quotes.send') && !q.isTemplate && q.status !== 'signed' ? (
              <Button
                icon={<Send aria-hidden className="size-4" />}
                onClick={async () => {
                  const fresh = await flush();
                  if (fresh) setDialog({ kind: 'send' });
                }}
              >
                {sent ? t('editor.resend') : t('editor.send')}
              </Button>
            ) : null}
          </div>
        }
      />

      {q.status === 'signed' ? (
        <Notice tone="good" title={t('editor.signedTitle')}>
          {t('editor.signedBody', {
            name: q.signature?.signerName ?? '',
            date: q.signedAt ? new Date(q.signedAt).toLocaleString('fr-BE') : '',
          })}{' '}
          {q.certificate?.status === 'signed' ? t('editor.certificateSigned') : ''}{' '}
          {q.projectId ? t('editor.projectCreated') : t('editor.projectPending')}
          {q.projectId ? (
            <>
              {' '}
              <Link href={`/chantiers/${q.projectId}`} className="font-semibold underline underline-offset-2">
                {t('editor.openProject')}
              </Link>
            </>
          ) : null}
        </Notice>
      ) : sent ? (
        <Notice
          tone="accent"
          title={t(`editor.sentTitle.${q.status}`, { date: q.sentAt ? relative(q.sentAt) : '' })}
        >
          {q.viewedAt ? `${t('editor.viewed', { date: relative(q.viewedAt) })} ` : ''}
          {t('editor.sentBody', { n: q.currentVersion.version + 1 })}
        </Notice>
      ) : null}
      {saveState === 'conflict' ? (
        <Notice tone="warn" title={t('editor.conflictTitle')}>
          {t('editor.conflictBody')}{' '}
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => {
              setSaveState('saved');
              void query.refetch().then((r) => {
                if (r.data) {
                  setServer(r.data);
                  setDoc(docFromQuote(r.data));
                  setRevision(r.data.currentVersion.revision);
                }
              });
            }}
          >
            {t('editor.reload')}
          </button>
        </Notice>
      ) : null}
      {saveState === 'error' && saveError ? <Notice tone="crit">{saveError}</Notice> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <TextAreaField
            label={t('editor.intro')}
            value={doc.intro}
            disabled={readOnly}
            placeholder={t('editor.introPlaceholder')}
            onChange={(e) => edit((d) => ({ ...d, intro: e.target.value }))}
            className="min-h-16"
          />
          {doc.sections.map((s, i) => (
            <SectionCard
              key={s.key}
              section={s}
              index={i}
              count={doc.sections.length}
              totals={totals}
              readOnly={readOnly}
              showCosts={showCosts}
              quoteRegime={quoteRegime}
              onChange={(next) => setSection(s.key, next)}
              onRemove={() => edit((d) => ({ ...d, sections: d.sections.filter((x) => x.key !== s.key) }))}
              onMove={(delta) => edit((d) => ({ ...d, sections: move(d.sections, i, i + delta) }))}
              onVatChange={(lineKey, regime) => onVatChange(s.key, lineKey, regime)}
              onError={(err) =>
                toast.show({ title: tc('errorTitle'), description: errorMessage(err), tone: 'crit' })
              }
            />
          ))}
          {!readOnly ? (
            <Button
              variant="secondary"
              className="self-start"
              icon={<Plus aria-hidden className="size-4" />}
              onClick={() => edit((d) => ({ ...d, sections: [...d.sections, newSection()] }))}
            >
              {t('editor.addSection')}
            </Button>
          ) : null}
          <TextAreaField
            label={t('editor.notes')}
            value={doc.notes}
            disabled={readOnly}
            placeholder={t('editor.notesPlaceholder')}
            onChange={(e) => edit((d) => ({ ...d, notes: e.target.value }))}
          />
          <div className="flex flex-wrap gap-2 border-t border-line-soft pt-4">
            {q.versions.length > 1 ? (
              <Button
                variant="ghost"
                size="sm"
                icon={<GitCompare aria-hidden className="size-4" />}
                onClick={() => setDialog({ kind: 'compare' })}
              >
                {t('editor.compare')}
              </Button>
            ) : null}
            {can('quotes.write') ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Copy aria-hidden className="size-4" />}
                  loading={duplicate.isPending}
                  onClick={() => duplicate.mutate({ template: false })}
                >
                  {t('editor.duplicate')}
                </Button>
                {!q.isTemplate ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Save aria-hidden className="size-4" />}
                    onClick={() => duplicate.mutate({ template: true })}
                  >
                    {t('editor.saveTemplate')}
                  </Button>
                ) : null}
                {['sent', 'viewed'].includes(q.status) ? (
                  <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'refuse' })}>
                    {t('editor.markRefused')}
                  </Button>
                ) : null}
                {q.status !== 'signed' ? (
                  <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'archive' })}>
                    {t('editor.archive')}
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        {/* Sur téléphone, le total reste visible pendant la saisie. */}
        <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-3 border-t border-line bg-surface/95 px-4 py-2.5 backdrop-blur md:-mx-8 md:px-8 xl:hidden">
          <span className="text-[13px] text-muted">{t('totals.gross')}</span>
          <span className="text-[18px] font-bold tabular-nums">
            {formatEuros(totals.document.totalGross)}
          </span>
        </div>
        <aside className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-20">
          <TotalsPanel
            totals={totals}
            doc={doc}
            quote={q}
            showCosts={showCosts}
            readOnly={readOnly}
            onChange={(patch) => edit((d) => ({ ...d, ...patch }))}
          />
          {q.opportunityId ? <VisitPanel opportunityId={q.opportunityId} /> : null}
          {q.timeline.length ? (
            <Card className="flex flex-col gap-3 p-4 md:p-5">
              <CardTitle as="h2">{t('editor.timeline')}</CardTitle>
              <ol className="flex flex-col gap-2" data-testid="quote-timeline">
                {q.timeline.map((e) => (
                  <li key={e.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="font-medium">{e.title}</span>
                    <span className="shrink-0 text-muted">{relative(e.occurredAt)}</span>
                  </li>
                ))}
              </ol>
            </Card>
          ) : null}
        </aside>
      </div>

      {dialog?.kind === 'send' ? (
        <SendDialog
          quote={q}
          totalGross={totals.document.totalGross}
          onClose={() => setDialog(null)}
          onSent={(sentQuote) => {
            setServer(sentQuote);
            setDoc(docFromQuote(sentQuote));
            setRevision(sentQuote.currentVersion.revision);
            setSaveState('saved');
            queryClient.setQueryData(['quotes', id], sentQuote);
          }}
        />
      ) : null}
      {dialog?.kind === 'dictation' ? (
        <DictationDialog
          quoteId={q.id}
          sections={doc.sections.map((s) => ({ key: s.key, title: s.title }))}
          onClose={() => setDialog(null)}
          onAdd={addProposals}
        />
      ) : null}
      {dialog?.kind === 'compare' ? <CompareDialog quote={q} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'refuse' ? <RefuseDialog quoteId={q.id} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'vat' ? (
        <VatJustificationDialog
          regime={dialog.regime}
          suggested={dialog.suggested}
          onCancel={() => setDialog(null)}
          onConfirm={(justification) => {
            const s = doc.sections.find((x) => x.key === dialog.sectionKey)!;
            setSection(s.key, {
              ...s,
              lines: s.lines.map((l) =>
                l.key === dialog.lineKey
                  ? { ...l, vatRegime: dialog.regime, vatJustification: justification }
                  : l,
              ),
            });
            setDialog(null);
          }}
        />
      ) : null}
      <ConfirmDialog
        open={dialog?.kind === 'archive'}
        onClose={() => setDialog(null)}
        onConfirm={() => archive.mutate()}
        loading={archive.isPending}
        title={t('editor.archiveTitle')}
        description={t('editor.archiveBody')}
        confirmLabel={t('editor.archive')}
        cancelLabel={tc('cancel')}
        closeLabel={tc('close')}
        destructive
      />
    </div>
  );
}

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const t = useTranslations('quotes.editor.save');
  if (state === 'error')
    return (
      <button type="button" onClick={onRetry} className="text-[13px] font-semibold text-crit underline">
        {t('error')}
      </button>
    );
  return (
    <span className="text-[13px] text-muted" role="status" aria-live="polite" data-testid="save-state">
      {t(state === 'conflict' ? 'error' : state)}
    </span>
  );
}
