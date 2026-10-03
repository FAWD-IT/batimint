import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ProjectsView } from './ProjectsView';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('projects'))('title') };
}

export default function ProjectsPage() {
  return <ProjectsView />;
}
