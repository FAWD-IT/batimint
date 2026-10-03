import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { RealtimeProvider } from '@/lib/realtime';
import { getMe } from '@/lib/server-api';
import { SessionProvider } from '@/lib/session';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/connexion');
  return (
    <SessionProvider me={me}>
      <RealtimeProvider>
        <AppShell>{children}</AppShell>
      </RealtimeProvider>
    </SessionProvider>
  );
}
