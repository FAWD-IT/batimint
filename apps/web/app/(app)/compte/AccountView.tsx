'use client';

import { Button, Chip, FormSection, Notice, PageHeader, Skeleton, TextField } from '@batimint/ui';
import { Laptop, Smartphone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useState } from 'react';
import { PasswordField } from '@/components/PasswordField';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { useRelativeTime } from '@/lib/use-relative-time';

interface SessionInfo {
  id: string;
  current: boolean;
  ip: string | null;
  userAgent: string | null;
  lastSeenAt: string;
}

function deviceLabel(ua: string | null, fallback: string): string {
  if (!ua) return fallback;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null;
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  return [browser, os].filter(Boolean).join(' · ') || fallback;
}

export function AccountView() {
  const t = useTranslations('account');
  const tc = useTranslations('common');
  const relativeTime = useRelativeTime();
  const me = useSession();
  const router = useRouter();
  const [name, setName] = useState(me.user.name);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwError, setPwError] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');

  const saveName = useApiMutation<string>((n) => ({ path: '/me', method: 'PATCH', body: { name: n } }), {
    successMessage: tc('saved'),
    onSuccess: () => router.refresh(),
  });
  const changePw = useApiMutation<typeof pw>(
    (p) => ({ path: '/me/password', body: { currentPassword: p.current, newPassword: p.next } }),
    {
      successMessage: t('passwordChanged'),
      onSuccess: () => {
        setPw({ current: '', next: '' });
        void sessions.refetch();
      },
    },
  );
  const sessions = useApi<{ items: SessionInfo[] }>(['sessions'], '/auth/sessions');
  const revoke = useApiMutation<string>((id) => ({ path: `/auth/sessions/${id}`, method: 'DELETE' }), {
    invalidate: [['sessions']],
    successMessage: t('revoked'),
  });
  const startSetup = useApiMutation<void, { secret: string; otpauthUrl: string }>(
    () => ({ path: '/auth/totp/setup', method: 'POST' }),
    {
      onSuccess: async (r) =>
        setSetup({
          secret: r.secret,
          qr: await QRCode.toString(r.otpauthUrl, { type: 'svg', margin: 1, width: 192 }),
        }),
    },
  );
  const enable = useApiMutation<string>((c) => ({ path: '/auth/totp/enable', body: { code: c } }), {
    successMessage: t('twofaOn'),
    onSuccess: () => {
      setSetup(null);
      setCode('');
      router.refresh();
    },
  });
  const disable = useApiMutation<string>((c) => ({ path: '/auth/totp/disable', body: { code: c } }), {
    successMessage: t('twofaOff'),
    onSuccess: () => {
      setCode('');
      router.refresh();
    },
  });
  useEffect(() => setName(me.user.name), [me.user.name]);

  const submitPw = (e: FormEvent) => {
    e.preventDefault();
    if (pw.next.length < 10) {
      setPwError('Le mot de passe doit compter au moins 10 caractères.');
      return;
    }
    setPwError(null);
    changePw.mutate(pw);
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader title={t('title')} />
      <div className="rounded-[16px] border border-line bg-surface px-5 py-6 md:px-8">
        <FormSection title={t('profile')}>
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim().length >= 2) saveName.mutate(name.trim());
            }}
          >
            <TextField
              containerClassName="flex-1"
              label={t('name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button
              type="submit"
              variant="secondary"
              loading={saveName.isPending}
              disabled={name.trim() === me.user.name}
            >
              {tc('save')}
            </Button>
          </form>
          <TextField label={t('email')} value={me.user.email} readOnly disabled />
        </FormSection>

        <FormSection title={t('password')}>
          <form onSubmit={submitPw} className="flex flex-col gap-3">
            <PasswordField
              label={t('currentPassword')}
              autoComplete="current-password"
              value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })}
            />
            <PasswordField
              label={t('newPassword')}
              autoComplete="new-password"
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
              error={pwError}
            />
            <Button
              type="submit"
              variant="secondary"
              className="self-start"
              loading={changePw.isPending}
              disabled={!pw.current || !pw.next}
            >
              {t('changePassword')}
            </Button>
          </form>
        </FormSection>

        <FormSection title={t('twofa')} description={t('twofaDescription')}>
          <Chip tone={me.user.totpEnabled ? 'good' : 'neutral'} dot className="self-start">
            {me.user.totpEnabled ? t('twofaEnabled') : t('twofaDisabled')}
          </Chip>
          {me.user.totpEnabled ? (
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                disable.mutate(code);
              }}
            >
              <TextField
                containerClassName="sm:w-48"
                label={t('code')}
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
              <Button
                type="submit"
                variant="secondary"
                loading={disable.isPending}
                disabled={code.length !== 6}
              >
                {t('disable2fa')}
              </Button>
            </form>
          ) : setup ? (
            <div className="flex flex-col gap-3">
              <p className="text-[14px]">{t('scanQr')}</p>
              <div
                className="size-48 rounded-[12px] border border-line bg-white p-2"
                role="img"
                aria-label={t('scanQr')}
                dangerouslySetInnerHTML={{ __html: setup.qr }}
              />
              <p className="text-[13px] break-all text-muted">{t('secretKey', { secret: setup.secret })}</p>
              <form
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  enable.mutate(code);
                }}
              >
                <TextField
                  containerClassName="sm:w-48"
                  label={t('code')}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  autoFocus
                />
                <Button type="submit" loading={enable.isPending} disabled={code.length !== 6}>
                  {t('enable2fa')}
                </Button>
              </form>
            </div>
          ) : (
            <Button
              className="self-start"
              variant="secondary"
              onClick={() => startSetup.mutate()}
              loading={startSetup.isPending}
            >
              {t('enable2fa')}
            </Button>
          )}
        </FormSection>

        <FormSection title={t('sessions')} description={t('sessionsDescription')}>
          {sessions.isLoading ? (
            <Skeleton className="h-24" />
          ) : sessions.data?.items.length ? (
            <ul className="flex flex-col gap-2">
              {sessions.data.items.map((s) => {
                const mobile = /iPhone|Android/.test(s.userAgent ?? '');
                const Icon = mobile ? Smartphone : Laptop;
                return (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center gap-3 rounded-[12px] border border-line-soft px-3 py-2"
                  >
                    <Icon aria-hidden className="size-5 text-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-medium">
                        {deviceLabel(s.userAgent, t('unknownDevice'))}{' '}
                        {s.current ? <Chip tone="accent">{t('thisDevice')}</Chip> : null}
                      </div>
                      <div className="text-[13px] text-muted">
                        {t('lastSeen', { date: relativeTime(s.lastSeenAt) })}
                        {s.ip ? ` · ${s.ip}` : ''}
                      </div>
                    </div>
                    {!s.current ? (
                      <Button variant="ghost" size="sm" onClick={() => revoke.mutate(s.id)}>
                        {t('revoke')}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <Notice>{t('sessionsDescription')}</Notice>
          )}
        </FormSection>
      </div>
    </div>
  );
}
