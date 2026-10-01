import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { LoginForm } from './LoginForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth'))('loginTitle') };
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
