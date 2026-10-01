'use client';

import { Button, Card, CardTitle, cn, ErrorState, LiveIndicator, Notice, PageHeader } from '@batimint/ui';
import { Check, Circle } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useRealtime, useRealtimeListener } from '@/lib/realtime';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';

type Step = 'idle' | 'emitted' | 'received' | 'timeout' | 'error';

export function DiagnosticView() {
  const t = useTranslations('settings.diagnostic');
  const tc = useTranslations('common');
  const ts = useTranslations('settings');
  const can = useCan();
  const errorMessage = useErrorMessage();
  const { connected } = useRealtime();
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [roundTrip, setRoundTrip] = useState<number | null>(null);
  const pending = useRef<{ eventId: string; started: number; timer: ReturnType<typeof setTimeout> } | null>(null);

  useRealtimeListener((msg) => {
    const p = pending.current;
    if (!p || msg.data?.['eventId'] !== p.eventId) return;
    clearTimeout(p.timer);
    pending.current = null;
    setRoundTrip(Math.round(performance.now() - p.started));
    setStep('received');
  });

  const run = async () => {
    setError(null);
    setRoundTrip(null);
    const started = performance.now();
    try {
      const res = await api<{ eventId: string }>('/diagnostics/ping', { body: {} });
      setStep('emitted');
      const timer = setTimeout(() => {
        pending.current = null;
        setStep('timeout');
      }, 15_000);
      pending.current = { eventId: res.eventId, started, timer };
    } catch (err) {
      setError(errorMessage(err));
      setStep('error');
    }
  };

  if (!can('diagnostics.run')) {
    return (
      <div className="mx-auto max-w-3xl">
        <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />
      </div>
    );
  }

  const steps: { key: string; label: string; done: boolean }[] = [
    { key: 'emitted', label: t('stepEmitted'), done: step === 'emitted' || step === 'received' },
    { key: 'processed', label: t('stepProcessed'), done: step === 'received' },
    { key: 'received', label: t('stepReceived'), done: step === 'received' },
  ];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader
        breadcrumb={<Link href="/parametres">{ts('title')}</Link>}
        title={t('title')}
        description={t('description')}
      />
      <Card className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>{t('realtimeTitle')}</CardTitle>
            <p className="max-w-lg text-[14px] text-muted">{t('realtimeDescription')}</p>
          </div>
          <Button onClick={() => void run()} loading={step === 'emitted'} loadingLabel={t('running')}>
            {step === 'emitted' ? t('running') : t('run')}
          </Button>
        </div>
        <ol className="flex flex-col gap-2" aria-live="polite">
          {steps.map((s) => (
            <li key={s.key} className="flex items-center gap-3 text-[14px]">
              {s.done ? (
                <Check aria-hidden className="size-5 text-good" />
              ) : (
                <Circle aria-hidden className={cn('size-5 text-line', step === 'emitted' && 'text-accent')} />
              )}
              <span className={s.done ? 'text-ink' : 'text-muted'}>{s.label}</span>
            </li>
          ))}
        </ol>
        {step === 'received' && roundTrip !== null ? (
          <Notice tone="good" title={t('success', { ms: roundTrip })}>
            <span data-testid="diagnostic-success">{t('stepReceived')}</span>
          </Notice>
        ) : null}
        {step === 'timeout' ? <Notice tone="warn">{t('timeout')}</Notice> : null}
        {step === 'error' && error ? <Notice tone="crit">{error}</Notice> : null}
        <div className="flex items-center justify-between border-t border-line-soft pt-4 text-[13px]">
          <span className="text-muted">{t('streamStatus')}</span>
          <LiveIndicator label={t('connected')} offlineLabel={t('disconnected')} connected={connected} />
        </div>
      </Card>
    </div>
  );
}
