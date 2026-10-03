import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ProjectCockpit } from './ProjectCockpit';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('projects'))('title') };
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectCockpit id={id} />;
}
