import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return { title: { default: t('title'), template: `%s · ${t('title')}` }, description: t('description') };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F4F3EF' },
    { media: '(prefers-color-scheme: dark)', color: '#0E0E0E' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={geist.variable} suppressHydrationWarning>
      <body className="min-h-dvh bg-bg text-ink">
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
