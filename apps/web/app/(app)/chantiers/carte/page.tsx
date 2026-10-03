import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ProjectsMap } from '@/components/projects/ProjectsMap';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('projects.map'))('title') };
}

export default function Page() {
  return <ProjectsMap />;
}
