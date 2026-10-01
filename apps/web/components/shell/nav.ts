import type { Action } from '@batimint/domain';
import { BookOpen, Briefcase, HardHat, type LucideIcon, Settings, Shield, Sun, Users } from 'lucide-react';

export interface NavItem {
  href: string;
  /** Clé de traduction dans « nav ». */
  labelKey: 'today' | 'pipeline' | 'customers' | 'library' | 'teams' | 'settings' | 'admin';
  icon: LucideIcon;
  permission?: Action;
  platformAdmin?: boolean;
}

/** N'apparaissent que les modules livrés : aucun lien ne mène à un écran vide. */
export const NAV_ITEMS: NavItem[] = [
  { href: '/aujourdhui', labelKey: 'today', icon: Sun },
  { href: '/opportunites', labelKey: 'pipeline', icon: Briefcase, permission: 'leads.read' },
  { href: '/clients', labelKey: 'customers', icon: Users, permission: 'customers.read' },
  { href: '/bibliotheque', labelKey: 'library', icon: BookOpen, permission: 'library.read' },
  { href: '/equipes', labelKey: 'teams', icon: HardHat, permission: 'employees.read' },
  { href: '/parametres', labelKey: 'settings', icon: Settings },
  { href: '/admin', labelKey: 'admin', icon: Shield, platformAdmin: true },
];
