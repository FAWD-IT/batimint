import { Logo } from '@batimint/ui';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-10 md:justify-center">
      <div className="mb-8">
        <Logo />
      </div>
      <main id="contenu" className="w-full max-w-[420px]">
        {children}
      </main>
    </div>
  );
}
