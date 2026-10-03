'use client';

import { Avatar, Button, Card, ConfirmDialog } from '@batimint/ui';
import { LayoutDashboard, LogOut, RefreshCw, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { clearAll } from '@/lib/field/queue';
import { useSession } from '@/lib/session';
import { useField } from './FieldProvider';
import { clockTime, SyncPill } from './shared';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
}

/** Profil : synchronisation, installation sur l'écran d'accueil, accès au bureau, déconnexion. */
export function FieldProfile() {
  const t = useTranslations('field.profile');
  const tr = useTranslations('roles');
  const tc = useTranslations('common');
  const me = useSession();
  const f = useField();
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallPrompt);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const logout = async () => {
    await api('/auth/logout', { method: 'POST', idempotencyKey: false }).catch(() => undefined);
    await clearAll();
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('terrain-')).map((k) => caches.delete(k)));
    }
    window.location.assign('/connexion');
  };

  return (
    <>
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-[24px] leading-tight font-bold tracking-[-0.02em]">{t('title')}</h1>
        <SyncPill />
      </header>
      <Card className="flex items-center gap-3 rounded-[20px] px-[18px] py-4">
        <Avatar name={me.user.name} size={48} />
        <div className="flex flex-col">
          <span className="text-[17px] font-semibold">{me.user.name}</span>
          <span className="text-[13px] text-muted">
            {me.role ? tr(me.role) : ''}
            {me.tenant ? ` · ${me.tenant.name}` : ''}
          </span>
        </div>
      </Card>
      <Card className="flex flex-col gap-3 rounded-[20px] px-[18px] py-4">
        <h2 className="text-[16px] font-semibold">{t('syncTitle')}</h2>
        <p className="text-[14px] text-muted">
          {f.pendingCount ? t('pending', { n: f.pendingCount }) : t('nothingPending')}
          {f.lastSyncAt ? ` ${t('lastSync', { time: clockTime(f.lastSyncAt) })}` : ''}
        </p>
        <p className="text-[13px] text-muted">{t('offlineHint')}</p>
        <Button
          size="lg"
          variant="secondary"
          icon={<RefreshCw aria-hidden className="size-4" />}
          loading={f.syncing}
          disabled={!f.online}
          onClick={() => void f.sync()}
        >
          {f.online ? t('syncNow') : t('offline')}
        </Button>
      </Card>
      {install ? (
        <Button
          size="lg"
          icon={<Smartphone aria-hidden className="size-5" />}
          onClick={() => void install.prompt().then(() => setInstall(null))}
        >
          {t('install')}
        </Button>
      ) : null}
      {me.role && me.role !== 'worker' ? (
        <Link
          href="/aujourdhui"
          className="inline-flex h-14 items-center justify-center gap-2 rounded-[14px] border border-line bg-surface text-[16px] font-semibold focus-visible:outline-2 focus-visible:outline-accent"
        >
          <LayoutDashboard aria-hidden className="size-5" />
          {t('backOffice')}
        </Link>
      ) : null}
      <Button
        size="lg"
        variant="ghost"
        icon={<LogOut aria-hidden className="size-5" />}
        onClick={() => (f.pendingCount ? setConfirm(true) : void logout())}
      >
        {t('logout')}
      </Button>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => void logout()}
        title={t('logoutPendingTitle')}
        description={t('logoutPendingText', { n: f.pendingCount })}
        confirmLabel={t('logoutAnyway')}
        cancelLabel={tc('cancel')}
        closeLabel={tc('close')}
        destructive
      />
    </>
  );
}
