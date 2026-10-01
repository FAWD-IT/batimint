import type { Action } from '@batimint/domain';
import { type LucideIcon, Settings, Sun } from 'lucide-react';

export interface NavItem {
  href: string;
  /** Clé de traduction dans « nav ». */
  labelKey: 'today' | 'settings';
  icon: LucideIcon;
  permission?: Action;
}

/** N'apparaissent que les modules livrés : aucun lien ne mène à un écran vide. */
export const NAV_ITEMS: NavItem[] = [
  { href: '/aujourdhui', labelKey: 'today', icon: Sun },
  // Tant que les paramètres ne contiennent que le diagnostic (M0), seuls les rôles qui peuvent le lancer les voient.
  { href: '/parametres', labelKey: 'settings', icon: Settings, permission: 'diagnostics.run' },
];
