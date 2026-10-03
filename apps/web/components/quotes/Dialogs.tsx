'use client';

import type { QuoteDto } from '@batimint/contracts';
import { formatEuros, type VatRegime } from '@batimint/domain';
import {
  Button,
  Checkbox,
  Chip,
  Dialog,
  Notice,
  SelectField,
  Skeleton,
  TextAreaField,
  TextField,
} from '@batimint/ui';
import { Mic, MicOff, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api } from '@/lib/api';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';

// ---------------------------------------------------------------------------
// Envoi
// ---------------------------------------------------------------------------

export function SendDialog({
  quote,
  totalGross,
  onClose,
  onSent,
}: {
  quote: QuoteDto;
  totalGross: bigint;
  onClose: () => void;
  onSent: (q: QuoteDto) => void;
}) {
  const t = useTranslations('quotes.send');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const [email, setEmail] = useState(quote.customer?.email ?? '');
  const [message, setMessage] = useState('');
  const [invalid, setInvalid] = useState(false);
  const send = useApiMutation<{ email: string; message: string }, QuoteDto>(
    (body) => ({ path: `/quotes/${quote.id}/send`, body }),
    {
      invalidate: [['quotes'], ['opportunities']],
      successMessage: (_r, v) => t('sent', { email: v.email }),
      onSuccess: (q) => {
        onSent(q);
        onClose();
      },
      silentError: true,
    },
  );
  const resend = quote.status !== 'draft';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setInvalid(true);
    send.mutate({ email: email.trim(), message });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={resend ? t('resendTitle') : t('title')}
      description={t('description', { total: formatEuros(totalGross), days: quote.validityDays })}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="send-form" loading={send.isPending}>
            {resend ? t('resend') : t('submit')}
          </Button>
        </>
      }
    >
      <form id="send-form" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {send.error ? <Notice tone="crit">{errorMessage(send.error)}</Notice> : null}
        <TextField
          label={t('email')}
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setInvalid(false);
          }}
          error={invalid ? t('emailInvalid') : null}
          autoFocus
          required
        />
        <TextAreaField
          label={t('message')}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t('messagePlaceholder')}
          optionalLabel={tc('optional')}
        />
        <p className="text-[13px] text-muted">{t('portalHint')}</p>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Justification d'un changement de TVA (02 P2.5)
// ---------------------------------------------------------------------------

export function VatJustificationDialog({
  regime,
  suggested,
  onCancel,
  onConfirm,
}: {
  regime: VatRegime;
  suggested: VatRegime;
  onCancel: () => void;
  onConfirm: (justification: string) => void;
}) {
  const t = useTranslations('quotes.vatOverride');
  const tv = useTranslations('quotes.vat');
  const tc = useTranslations('common');
  const [text, setText] = useState('');
  const [error, setError] = useState(false);
  return (
    <Dialog
      open
      onClose={onCancel}
      title={t('title')}
      description={t('description', { from: tv(`long.${suggested}`), to: tv(`long.${regime}`) })}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="vat-form">
            {t('confirm')}
          </Button>
        </>
      }
    >
      <form
        id="vat-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim().length < 5) return setError(true);
          onConfirm(text.trim());
        }}
      >
        <TextAreaField
          label={t('justification')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          error={error ? t('required') : null}
          hint={t('hint')}
          autoFocus
        />
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Dictée (P2.3) : texte ou voix → lignes proposées, à valider une par une
// ---------------------------------------------------------------------------

export interface Proposal {
  source: string;
  description: string;
  quantity: string;
  unit: string;
  confidence: number;
  item: {
    id: string;
    code: string;
    name: string;
    unit: string;
    kind: string;
    salePrice: number;
    purchasePrice?: number;
    laborHours: string;
    vatRate: string;
  } | null;
}

type SpeechCtor = new () => {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
};

const noopSubscribe = () => () => undefined;
function speechCtor(): SpeechCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function DictationDialog({
  quoteId,
  sections,
  onClose,
  onAdd,
}: {
  quoteId: string;
  sections: { key: string; title: string }[];
  onClose: () => void;
  onAdd: (sectionKey: string, proposals: Proposal[]) => void;
}) {
  const t = useTranslations('quotes.dictation');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const [text, setText] = useState('');
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [sectionKey, setSectionKey] = useState(sections[0]?.key ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const recognition = useRef<InstanceType<SpeechCtor> | null>(null);
  const canSpeak = useSyncExternalStore(
    noopSubscribe,
    () => speechCtor() !== null,
    () => false,
  );
  useEffect(() => () => recognition.current?.stop(), []);

  const toggleVoice = () => {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const Ctor = speechCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = 'fr-BE';
    r.interimResults = false;
    r.continuous = true;
    r.onresult = (e) => {
      const said = Array.from(e.results)
        .map((res) => res[0]?.transcript ?? '')
        .join('\n');
      setText((prev) => (prev ? `${prev}\n${said}` : said));
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recognition.current = r;
    r.start();
    setListening(true);
  };

  const propose = async () => {
    if (text.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ lines: Proposal[] }>(`/quotes/${quoteId}/draft-lines`, {
        body: { text },
        idempotencyKey: false,
      });
      setProposals(r.lines);
      setChosen(
        new Set(r.lines.map((l, i) => (l.item && l.confidence >= 0.5 ? i : -1)).filter((i) => i >= 0)),
      );
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
      className="w-[min(94vw,680px)]"
      footer={
        proposals ? (
          <>
            <Button variant="secondary" onClick={() => setProposals(null)}>
              {tc('back')}
            </Button>
            <Button
              disabled={chosen.size === 0}
              onClick={() => {
                onAdd(
                  sectionKey,
                  proposals.filter((_, i) => chosen.has(i)),
                );
                onClose();
              }}
            >
              {t('add', { count: chosen.size })}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {tc('cancel')}
            </Button>
            <Button
              icon={<Sparkles aria-hidden className="size-4" />}
              loading={busy}
              onClick={() => void propose()}
            >
              {t('propose')}
            </Button>
          </>
        )
      }
    >
      {error ? <Notice tone="crit">{error}</Notice> : null}
      {!proposals ? (
        <div className="flex flex-col gap-3">
          <TextAreaField
            label={t('text')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('placeholder')}
            className="min-h-32"
            autoFocus
          />
          {canSpeak ? (
            <Button
              variant={listening ? 'danger' : 'secondary'}
              className="self-start"
              icon={
                listening ? <MicOff aria-hidden className="size-4" /> : <Mic aria-hidden className="size-4" />
              }
              onClick={toggleVoice}
            >
              {listening ? t('stopVoice') : t('voice')}
            </Button>
          ) : null}
          {busy ? <Skeleton className="h-20" /> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sections.length > 1 ? (
            <SelectField
              label={t('section')}
              value={sectionKey}
              onChange={(e) => setSectionKey(e.target.value)}
              options={sections.map((s, i) => ({ value: s.key, label: s.title || `${i + 1}` }))}
            />
          ) : null}
          <ul className="flex flex-col divide-y divide-line-soft rounded-[12px] border border-line">
            {proposals.map((p, i) => (
              <li key={i} className="px-3 py-2">
                <Checkbox
                  checked={chosen.has(i)}
                  onChange={(e) =>
                    setChosen((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(i);
                      else next.delete(i);
                      return next;
                    })
                  }
                  label={
                    <span className="flex flex-col">
                      <span className="font-medium">
                        {p.quantity.replace('.', ',')} {p.unit} · {p.item?.name ?? p.description}
                      </span>
                      <span className="text-[12px] text-muted">
                        {t('heard', { text: p.source })}
                        {p.item
                          ? ` · ${p.item.code} · ${formatEuros(BigInt(p.item.salePrice))} / ${p.item.unit}`
                          : ''}
                      </span>
                      {!p.item ? (
                        <Chip tone="warn" className="mt-1 self-start">
                          {t('noMatch')}
                        </Chip>
                      ) : null}
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Comparatif de versions
// ---------------------------------------------------------------------------

interface Change {
  kind: 'added' | 'removed' | 'changed';
  sectionTitle: string;
  description: string;
  fields: string[];
  before?: { quantity: string; unitPrice: number };
  after?: { quantity: string; unitPrice: number };
}

export function CompareDialog({ quote, onClose }: { quote: QuoteDto; onClose: () => void }) {
  const t = useTranslations('quotes.compare');
  const tc = useTranslations('common');
  const versions = quote.versions;
  const [from, setFrom] = useState(versions.at(-2)?.id ?? versions[0]!.id);
  const [to, setTo] = useState(versions.at(-1)!.id);
  const diff = useApi<{ changes: Change[]; totalGrossBefore: number; totalGrossAfter: number }>(
    ['quotes', quote.id, 'compare', from, to],
    from !== to ? `/quotes/${quote.id}/compare?from=${from}&to=${to}` : null,
  );
  const opts = versions.map((v) => ({ value: v.id, label: t('version', { n: v.version }) }));
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title')}
      closeLabel={tc('close')}
      className="w-[min(94vw,680px)]"
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label={t('from')}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            options={opts}
          />
          <SelectField label={t('to')} value={to} onChange={(e) => setTo(e.target.value)} options={opts} />
        </div>
        {diff.isLoading ? (
          <Skeleton className="h-24" />
        ) : diff.data ? (
          <>
            <p className="text-[14px]">
              {t('totals', {
                before: formatEuros(BigInt(diff.data.totalGrossBefore)),
                after: formatEuros(BigInt(diff.data.totalGrossAfter)),
              })}
            </p>
            {diff.data.changes.length === 0 ? (
              <p className="text-[14px] text-muted">{t('none')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line-soft rounded-[12px] border border-line">
                {diff.data.changes.map((c, i) => (
                  <li key={i} className="flex items-start gap-3 px-3 py-2 text-[14px]">
                    <Chip tone={c.kind === 'added' ? 'good' : c.kind === 'removed' ? 'crit' : 'warn'}>
                      {t(`kind.${c.kind}`)}
                    </Chip>
                    <span className="min-w-0">
                      <span className="block font-medium">{c.description}</span>
                      <span className="block text-[12px] text-muted">
                        {c.sectionTitle}
                        {c.kind === 'changed' ? ` · ${c.fields.map((f) => t(`field.${f}`)).join(', ')}` : ''}
                        {c.before && c.after
                          ? ` · ${c.before.quantity} × ${formatEuros(BigInt(c.before.unitPrice))} → ${c.after.quantity} × ${formatEuros(BigInt(c.after.unitPrice))}`
                          : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

/** Marque le devis comme refusé (refus reçu hors portail). */
export function RefuseDialog({ quoteId, onClose }: { quoteId: string; onClose: () => void }) {
  const t = useTranslations('quotes.refuse');
  const tc = useTranslations('common');
  const can = useCan();
  const [reason, setReason] = useState('');
  const refuse = useApiMutation<{ reason: string }>((body) => ({ path: `/quotes/${quoteId}/refuse`, body }), {
    invalidate: [['quotes']],
    successMessage: t('done'),
    onSuccess: onClose,
  });
  if (!can('quotes.write')) return null;
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button variant="danger" loading={refuse.isPending} onClick={() => refuse.mutate({ reason })}>
            {t('confirm')}
          </Button>
        </>
      }
    >
      <TextField
        label={t('reason')}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        optionalLabel={tc('optional')}
        autoFocus
      />
    </Dialog>
  );
}
