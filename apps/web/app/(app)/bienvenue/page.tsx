import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { WelcomeView } from './WelcomeView';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('welcome'))('title') };
}

export default function WelcomePage() {
  return <WelcomeView />;
}
