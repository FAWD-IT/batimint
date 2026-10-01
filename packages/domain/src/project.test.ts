import { describe, expect, it } from 'vitest';
import {
  addWorkingDays,
  belgianPublicHolidays,
  brusselsDate,
  easterSunday,
  isWorkingDay,
  workingDaysBetween,
} from './calendar';
import {
  changeOrderTargetKey,
  computeChangeOrder,
  currentProjectStep,
  mentionsToPlain,
  parseMentions,
  percentInt,
  projectSchedule,
  projectTodos,
  shiftEndDate,
  splitMentions,
} from './project';

describe('calendrier belge', () => {
  it('calcule Pâques et les fériés mobiles', () => {
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    const h = Object.fromEntries(belgianPublicHolidays(2026).map((x) => [x.key, x.date]));
    expect(h['easter_monday']).toBe('2026-04-06');
    expect(h['ascension']).toBe('2026-05-14');
    expect(h['whit_monday']).toBe('2026-05-25');
    expect(belgianPublicHolidays(2026)).toHaveLength(10);
  });

  it('compte les jours ouvrés hors week-end et fériés', () => {
    expect(isWorkingDay('2026-07-21')).toBe(false); // fête nationale (mardi)
    expect(isWorkingDay('2026-10-03')).toBe(false); // samedi
    expect(isWorkingDay('2026-10-01')).toBe(true);
    expect(workingDaysBetween('2026-09-21', '2026-10-09')).toBe(15);
    expect(workingDaysBetween('2026-11-09', '2026-11-13')).toBe(4); // 11 novembre
    expect(workingDaysBetween('2026-10-09', '2026-10-01')).toBe(0);
    expect(addWorkingDays('2026-10-09', 1)).toBe('2026-10-12');
    expect(addWorkingDays('2026-11-10', 1)).toBe('2026-11-12'); // 11 novembre
  });

  it('donne la date civile à Bruxelles', () => {
    expect(brusselsDate(new Date('2026-10-01T22:30:00Z'))).toBe('2026-10-02');
    expect(brusselsDate(new Date('2026-01-15T22:30:00Z'))).toBe('2026-01-15');
  });
});

describe('étapes et calendrier du chantier', () => {
  it('place le chantier sur la barre d’étapes', () => {
    expect(currentProjectStep({ status: 'preparation' })).toBe('works');
    expect(currentProjectStep({ status: 'in_progress', progress: '0.62' })).toBe('works');
    expect(currentProjectStep({ status: 'in_progress', progress: '1' })).toBe('reception');
    expect(currentProjectStep({ status: 'provisional_acceptance' })).toBe('final_invoice');
    expect(currentProjectStep({ status: 'closed', finalInvoiceIssued: true })).toBe('paid');
    expect(currentProjectStep({ status: 'closed', finalInvoiceIssued: true, fullyPaid: true })).toBe('done');
  });

  it('« jour 9 sur 15 » en jours ouvrés', () => {
    expect(projectSchedule({ startDate: '2026-09-21', endDate: '2026-10-09', today: '2026-10-01' })).toEqual({
      day: 9,
      totalDays: 15,
      lateDays: 0,
    });
    expect(
      projectSchedule({ startDate: '2026-10-05', endDate: '2026-10-09', today: '2026-10-01' }).day,
    ).toBeNull();
    expect(projectSchedule({ startDate: null, endDate: null, today: '2026-10-01' })).toEqual({
      day: null,
      totalDays: null,
      lateDays: 0,
    });
    expect(
      projectSchedule({ startDate: '2026-09-01', endDate: '2026-09-25', today: '2026-10-01' }).lateDays,
    ).toBe(4);
  });

  it('décale la date de fin d’un avenant en jours ouvrés', () => {
    expect(shiftEndDate('2026-10-09', 3)).toBe('2026-10-14');
    expect(shiftEndDate('2026-10-09', 0)).toBe('2026-10-09');
    expect(shiftEndDate(null, 3)).toBeNull();
  });
});

describe('avenants', () => {
  const base = { unitCost: 0n, laborHours: 0, vatRegime: 'reduced_6' as const };
  it('se calcule comme un devis, groupé par poste cible', () => {
    const t = computeChangeOrder([
      {
        ...base,
        id: 'a',
        description: 'Niche murale',
        unit: 'u',
        quantity: 1,
        unitPrice: 95_000n,
        unitCost: 60_000n,
        laborHours: 4,
        budgetLineId: 'bl-carrelage',
      },
      {
        ...base,
        id: 'b',
        description: 'Faïence niche',
        unit: 'm²',
        quantity: '1.5',
        unitPrice: 20_000n,
        unitCost: 9_000n,
        budgetLineId: 'bl-carrelage',
      },
      {
        ...base,
        id: 'c',
        description: 'Spot LED',
        unit: 'u',
        quantity: 2,
        unitPrice: 6_000n,
        budgetLineId: null,
        newPostLabel: 'Éclairage ',
      },
    ]);
    expect(t.document.totalNet).toBe(137_000n);
    expect(t.document.totalGross).toBe(145_220n);
    expect(t.byTarget).toEqual([
      expect.objectContaining({ budgetLineId: 'bl-carrelage', sale: 125_000n, cost: 73_500n }),
      expect.objectContaining({ budgetLineId: null, label: 'Éclairage', sale: 12_000n, cost: 0n }),
    ]);
    expect(t.laborHours.toNumber()).toBe(4);
  });

  it('identifie le poste cible', () => {
    expect(changeOrderTargetKey({ budgetLineId: 'x', newPostLabel: null })).toBe('x');
    expect(changeOrderTargetKey({ budgetLineId: null, newPostLabel: ' Peinture ' })).toBe('new:peinture');
    expect(changeOrderTargetKey({ budgetLineId: null })).toBe('new:avenant');
  });
});

describe('mentions', () => {
  const id1 = '01900000-0000-7000-8000-000000000001';
  const id2 = '01900000-0000-7000-8000-000000000002';
  const text = `Merci @[Karim Benali](${id1}), vois avec @[Sophie](${id2}) et @[Karim Benali](${id1}).`;
  it('extrait les personnes mentionnées une seule fois', () => {
    expect(parseMentions(text)).toEqual([id1, id2]);
    expect(parseMentions('pas de mention @Karim')).toEqual([]);
  });
  it('rend le texte lisible et découpable', () => {
    expect(mentionsToPlain(text)).toBe('Merci @Karim Benali, vois avec @Sophie et @Karim Benali.');
    expect(splitMentions(`@[Sophie](${id2}) ok`)).toEqual([{ mention: 'Sophie', id: id2 }, { text: ' ok' }]);
  });
});

describe('à faire du chantier', () => {
  it('trie par gravité puis ancienneté', () => {
    const todos = projectTodos({
      today: '2026-10-01',
      projectId: 'p',
      lateDays: 0,
      invoices: [
        { id: 'i1', number: '2026-118', status: 'sent', dueDate: '2026-09-28', balance: 1_628_160n },
        { id: 'i2', number: '2026-119', status: 'sent', dueDate: '2026-10-20', balance: 100n },
        { id: 'i3', number: null, status: 'draft', dueDate: '2026-09-01', balance: 100n },
        { id: 'i4', number: '2026-090', status: 'paid', dueDate: '2026-09-01', balance: 0n },
      ],
      budgetLines: [
        { id: 'b1', label: 'Carrelage', budgetedCost: 100_000n, committed: 112_000n, drift: true },
        { id: 'b2', label: 'Plomberie', budgetedCost: 100_000n, committed: 50_000n, drift: false },
      ],
      changeOrders: [
        { id: 'c2', ordinal: 2, title: 'Niche', status: 'signed', sentAt: '2026-09-29' },
        { id: 'c3', ordinal: 3, title: 'Receveur', status: 'sent', sentAt: '2026-09-30' },
        { id: 'c4', ordinal: 4, title: 'Peinture', status: 'draft', sentAt: null },
      ],
      openQuestions: [{ id: 'q', subject: 'Avenant n°3', author: 'M. Dupont' }],
    });
    expect(todos.map((t) => t.kind)).toEqual([
      'invoice_overdue',
      'budget_drift',
      'client_question',
      'change_order_awaiting',
      'change_order_draft',
    ]);
    expect(todos[0]).toMatchObject({ number: '2026-118', days: 3 });
    expect(todos[1]).toMatchObject({ overPercent: 12 });
  });

  it('signale le retard', () => {
    const t = projectTodos({
      today: '2026-10-01',
      projectId: 'p',
      lateDays: 2,
      invoices: [],
      budgetLines: [],
      changeOrders: [],
      openQuestions: [],
    });
    expect(t).toEqual([{ kind: 'project_late', ref: 'p', days: 2, severity: 'warn' }]);
  });

  it('arrondit les pourcentages affichés', () => {
    expect(percentInt('0.6249')).toBe(62);
    expect(percentInt('0.625')).toBe(63);
  });
});
