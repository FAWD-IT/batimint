import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  assignableRoles,
  can,
  canSeeMargins,
  canSeePrices,
  isReadOnlyRole,
  isRole,
  permissionsOf,
  redactFinancialFields,
  ROLES,
} from './permissions';

describe('03 §1 — matrice de permissions', () => {
  it('le patron peut tout faire', () => {
    expect(permissionsOf('owner')).toEqual([...ACTIONS]);
  });

  it('un Ouvrier ne voit ni les prix ni les marges', () => {
    expect(canSeePrices('worker')).toBe(false);
    expect(canSeeMargins('worker')).toBe(false);
    expect(can('worker', 'time.clock')).toBe(true);
    expect(can('worker', 'field.report')).toBe(true);
    expect(can('worker', 'invoices.read')).toBe(false);
  });

  it('le Comptable ne modifie rien', () => {
    expect(isReadOnlyRole('accountant')).toBe(true);
    expect(can('accountant', 'exports.read')).toBe(true);
    expect(can('accountant', 'invoices.write')).toBe(false);
    for (const r of ROLES.filter((r) => r !== 'accountant' && r !== 'worker')) {
      expect(isReadOnlyRole(r)).toBe(false);
    }
  });

  it('seuls Owner et Admin voient l’INSS et gèrent les membres', () => {
    for (const r of ROLES) {
      expect(can(r, 'employees.sensitive.read')).toBe(r === 'owner' || r === 'admin');
      expect(can(r, 'members.manage')).toBe(r === 'owner' || r === 'admin');
    }
  });

  it('l’abonnement est réservé au patron', () => {
    for (const r of ROLES) expect(can(r, 'subscription.manage')).toBe(r === 'owner');
  });

  it('le Bureau fait les devis et factures', () => {
    expect(can('office', 'quotes.write')).toBe(true);
    expect(can('office', 'invoices.issue')).toBe(true);
    expect(can('office', 'audit.read')).toBe(false);
  });

  it('le chef de chantier valide les heures et fait signer les bons', () => {
    expect(can('site_manager', 'time.validate')).toBe(true);
    expect(can('site_manager', 'work_orders.create')).toBe(true);
    expect(can('site_manager', 'projects.finance.read')).toBe(false);
  });

  it('rôles attribuables', () => {
    expect(assignableRoles('owner')).toContain('owner');
    expect(assignableRoles('admin')).not.toContain('owner');
    expect(assignableRoles('office')).toEqual([]);
    expect(isRole('worker')).toBe(true);
    expect(isRole('boss')).toBe(false);
  });

  it('expurge récursivement les champs financiers', () => {
    const input = {
      id: '1',
      name: 'Carrelage',
      unitPrice: 100n,
      tasks: [{ title: 'Pose', costCents: 3n, done: true }],
      budget: { total: 5n },
      at: new Date(0),
    };
    expect(redactFinancialFields(input)).toEqual({
      id: '1',
      name: 'Carrelage',
      tasks: [{ title: 'Pose', done: true }],
      at: new Date(0),
    });
  });
});
