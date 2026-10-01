import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LibraryView } from './LibraryView';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('library'))('title') };
}

export default function LibraryPage() {
  return <LibraryView />;
}
