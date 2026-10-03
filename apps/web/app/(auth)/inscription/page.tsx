import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SignupForm } from './SignupForm';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth'))('signupTitle') };
}

export default function SignupPage() {
  return <SignupForm />;
}
