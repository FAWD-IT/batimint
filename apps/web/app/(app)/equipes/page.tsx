import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PeopleView } from './PeopleView';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('people'))('title') };
}

export default function PeoplePage() {
  return <PeopleView />;
}
