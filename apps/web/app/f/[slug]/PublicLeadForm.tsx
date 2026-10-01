'use client';

import { Button, Checkbox, Notice, TextAreaField, TextField } from '@batimint/ui';
import { CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type CSSProperties, type FormEvent, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';

/**
 * Formulaire public de demande de devis (P2.1), aux couleurs de l'entreprise.
 * Anti-robot discret : champ piège invisible et temps de saisie, sans captcha pénible.
 */
export function PublicLeadForm({
  slug,
  tenantName,
  accent,
  logoUrl,
  embedded,
  preview,
}: {
  slug: string;
  tenantName: string;
  accent: string;
  logoUrl: string | null;
  embedded: boolean;
  preview: boolean;
}) {
  const t = useTranslations('webform.public');
  const [v, setV] = useState({
    name: '',
    email: '',
    phone: '',
    street: '',
    postalCode: '',
    city: '',
    message: '',
    website: '',
    consent: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [serverError, setServerError] = useState<string | null>(null);
  const startedAt = useRef<number | null>(null);
  const root = useRef<HTMLDivElement>(null);

  // Intégration : la page parente ajuste la hauteur de l'iframe (voir /embed.js).
  useEffect(() => {
    if (!embedded || !root.current || window.parent === window) return;
    const post = () =>
      window.parent.postMessage(
        { type: 'batimint:height', height: document.documentElement.scrollHeight },
        '*',
      );
    const observer = new ResizeObserver(post);
    observer.observe(root.current);
    post();
    return () => observer.disconnect();
  }, [embedded]);

  const field = (k: Exclude<keyof typeof v, 'consent'>) => ({
    value: v[k],
    error: errors[k] ?? null,
    onChange: (e: { target: { value: string } }) => {
      startedAt.current ??= Date.now();
      setV({ ...v, [k]: e.target.value });
    },
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (v.name.trim().length < 2) errs['name'] = t('nameRequired');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) errs['email'] = t('emailInvalid');
    if (v.message.trim().length < 5) errs['message'] = t('messageRequired');
    if (!v.consent) errs['consent'] = t('consentRequired');
    setErrors(errs);
    if (Object.keys(errs).length) {
      root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    if (preview) return setState('sent');
    setState('sending');
    setServerError(null);
    try {
      await api(`/public/forms/${encodeURIComponent(slug)}/leads`, {
        body: {
          name: v.name,
          email: v.email,
          phone: v.phone,
          street: v.street,
          postalCode: v.postalCode,
          city: v.city,
          message: v.message,
          website: v.website,
          consent: true,
          fillMs: startedAt.current ? Date.now() - startedAt.current : 0,
        },
      });
      setState('sent');
    } catch (err) {
      setState('error');
      setServerError(err instanceof ApiError && err.message ? err.message : t('error'));
    }
  };

  return (
    <div
      ref={root}
      style={{ '--accent': accent } as CSSProperties}
      className={embedded ? 'bg-bg px-4 py-6' : 'flex min-h-dvh justify-center bg-bg px-4 py-10'}
    >
      <main className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header className="flex items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt={tenantName} className="h-10 w-auto max-w-40 object-contain" />
          ) : (
            <span className="text-[17px] font-bold">{tenantName}</span>
          )}
        </header>
        {state === 'sent' ? (
          <div
            role="status"
            className="flex flex-col items-start gap-3 rounded-[16px] border border-line bg-surface p-6"
          >
            <CheckCircle2 aria-hidden className="size-8 text-accent" />
            <p className="text-[17px] font-semibold">{t('sent', { company: tenantName })}</p>
          </div>
        ) : (
          <>
            <div>
              <h1 className="text-[26px] font-bold tracking-[-0.02em]">{t('title')}</h1>
              <p className="mt-1 text-[15px] text-muted">{t('intro', { company: tenantName })}</p>
            </div>
            <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
              {serverError ? <Notice tone="crit">{serverError}</Notice> : null}
              <TextField label={t('name')} autoComplete="name" required {...field('name')} />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label={t('email')}
                  type="email"
                  autoComplete="email"
                  required
                  {...field('email')}
                />
                <TextField label={t('phone')} type="tel" autoComplete="tel" {...field('phone')} />
              </div>
              <TextField label={t('street')} autoComplete="street-address" {...field('street')} />
              <div className="grid grid-cols-[120px_1fr] gap-4">
                <TextField
                  label={t('postalCode')}
                  inputMode="numeric"
                  autoComplete="postal-code"
                  {...field('postalCode')}
                />
                <TextField label={t('city')} autoComplete="address-level2" {...field('city')} />
              </div>
              <TextAreaField
                label={t('message')}
                placeholder={t('messagePlaceholder')}
                required
                className="min-h-32"
                {...field('message')}
              />
              {/* Champ piège : invisible pour un humain, rempli par les robots. */}
              <div aria-hidden className="absolute -left-[9999px] h-0 overflow-hidden">
                <label>
                  Website
                  <input
                    tabIndex={-1}
                    autoComplete="off"
                    value={v.website}
                    onChange={(e) => setV({ ...v, website: e.target.value })}
                  />
                </label>
              </div>
              <div>
                <Checkbox
                  label={t('consent')}
                  checked={v.consent}
                  aria-invalid={errors['consent'] ? true : undefined}
                  onChange={(e) => setV({ ...v, consent: e.target.checked })}
                />
                {errors['consent'] ? (
                  <p role="alert" className="text-[13px] text-crit">
                    {errors['consent']}
                  </p>
                ) : null}
              </div>
              <Button type="submit" variant="accent" size="lg" loading={state === 'sending'}>
                {t('send')}
              </Button>
            </form>
          </>
        )}
        <p className="text-center text-[12px] text-muted">{t('poweredBy')}</p>
      </main>
    </div>
  );
}
