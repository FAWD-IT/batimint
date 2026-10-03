'use client';

import { buttonClasses } from '@batimint/ui';
import { Phone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CSSProperties, ReactNode } from 'react';

export interface PortalTenant {
  name: string;
  logoUrl: string | null;
  phone: string | null;
  email: string | null;
}

/** Cadre commun des portails client (devis, chantier) : logo et couleur du tenant, contact. */
export function PortalShell({
  accent,
  tenant,
  subtitle,
  contact,
  children,
}: {
  accent: string;
  tenant?: PortalTenant;
  subtitle?: string;
  /** Interlocuteur affiché en pied de page (le chef de chantier), sinon l'entreprise. */
  contact?: { name: string; phone: string | null; email: string | null } | null;
  children: ReactNode;
}) {
  const who = contact ?? (tenant ? { name: tenant.name, phone: tenant.phone, email: tenant.email } : null);
  const t = useTranslations('portal');
  return (
    <div style={{ '--accent': accent } as CSSProperties} className="min-h-dvh bg-surface">
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
        <header className="flex items-center gap-3 border-b border-line-soft px-5 pt-6 pb-4">
          {tenant?.logoUrl ? (
            <img src={tenant.logoUrl} alt="" className="size-10 rounded-[10px] object-contain" />
          ) : (
            <span
              aria-hidden
              className="flex size-10 items-center justify-center rounded-[10px] bg-line-soft text-[15px] font-bold"
            >
              {tenant?.name.slice(0, 1) ?? ''}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold">{tenant?.name ?? ''}</p>
            {subtitle ? <p className="truncate text-[12px] text-muted">{subtitle}</p> : null}
          </div>
        </header>
        <main className="flex flex-1 flex-col gap-5 px-5 py-5">{children}</main>
        {who ? (
          <footer className="flex items-center justify-between gap-3 border-t border-line-soft px-5 pt-3.5 pb-6">
            <span className="flex flex-col">
              <span className="text-[12px] text-muted">{t('contact')}</span>
              <span className="text-[14px] font-semibold">{who.name}</span>
            </span>
            {who.phone ? (
              <a href={`tel:${who.phone.replace(/\s/g, '')}`} className={buttonClasses('secondary')}>
                <Phone aria-hidden className="size-4" />
                {t('call')}
              </a>
            ) : who.email ? (
              <a href={`mailto:${who.email}`} className={buttonClasses('secondary')}>
                {t('write')}
              </a>
            ) : null}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
