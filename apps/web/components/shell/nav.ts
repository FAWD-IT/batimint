import type { Action } from '@batimint/domain';
import {
  BookOpen,
  CalendarDays,
  Briefcase,
  Building2,
  HardHat,
  type LucideIcon,
  Settings,
  ShoppingCart,
  Receipt,
  Shield,
  Smartphone,
  Sun,
  Users,
  FileText,
} from 'lucide-react';

export interface NavItem {
  href: string;
  /** Clé de traduction dans « nav ». */
  labelKey:
    | 'today'
    | 'projects'
    | 'planning'
    | 'field'
    | 'pipeline'
    | 'customers'
    | 'quotes'
    | 'purchasing'
    | 'billing'
    | 'library'
    | 'teams'
    | 'settings'
    | 'admin';
  icon: LucideIcon;
  permission?: Action;
  platformAdmin?: boolean;
}

/** N'apparaissent que les modules livrés : aucun lien ne mène à un écran vide. */
export const NAV_ITEMS: NavItem[] = [
  { href: '/aujourdhui', labelKey: 'today', icon: Sun },
  { href: '/chantiers', labelKey: 'projects', icon: Building2, permission: 'projects.read' },
  { href: '/planning', labelKey: 'planning', icon: CalendarDays, permission: 'planning.read' },
  // Vue terrain (mobile) : le chef y pointe son équipe et valide les heures.
  { href: '/terrain', labelKey: 'field', icon: Smartphone, permission: 'time.clock_team' },
  { href: '/opportunites', labelKey: 'pipeline', icon: Briefcase, permission: 'leads.read' },
  { href: '/devis', labelKey: 'quotes', icon: FileText, permission: 'quotes.read' },
  { href: '/facturation', labelKey: 'billing', icon: Receipt, permission: 'invoices.read' },
  { href: '/achats', labelKey: 'purchasing', icon: ShoppingCart, permission: 'purchases.read' },
  { href: '/clients', labelKey: 'customers', icon: Users, permission: 'customers.read' },
  { href: '/bibliotheque', labelKey: 'library', icon: BookOpen, permission: 'library.read' },
  { href: '/equipes', labelKey: 'teams', icon: HardHat, permission: 'employees.read' },
  { href: '/parametres', labelKey: 'settings', icon: Settings },
  { href: '/admin', labelKey: 'admin', icon: Shield, platformAdmin: true },
];
