import type { Action } from '@batimint/domain';
import { HardHat, type LucideIcon, Settings, Shield, Sun } from 'lucide-react';

export interface NavItem {
  href: string;
  /** Clé de traduction dans « nav ». */
  labelKey: 'today' | 'teams' | 'settings' | 'admin';
  icon: LucideIcon;
  permission?: Action;
  platformAdmin?: boolean;
}

/** N'apparaissent que les modules livrés : aucun lien ne mène à un écran vide. */
export const NAV_ITEMS: NavItem[] = [
  { href: '/aujourdhui', labelKey: 'today', icon: Sun },
  { href: '/equipes', labelKey: 'teams', icon: HardHat, permission: 'employees.read' },
  { href: '/parametres', labelKey: 'settings', icon: Settings },
  { href: '/admin', labelKey: 'admin', icon: Shield, platformAdmin: true },
];
