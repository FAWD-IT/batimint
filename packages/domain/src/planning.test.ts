import { describe, expect, it } from 'vitest';
import {
  buildICal,
  detectConflicts,
  firstPlannedDay,
  isValidRange,
  moveSlot,
  resizeSlot,
  slotHalfDays,
  slotWorkingDays,
} from './planning';

const utf8Length = (s: string) =>
  [...s].reduce((n, ch) => {
    const cp = ch.codePointAt(0)!;
    return n + (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);
  }, 0);

// Semaine du lundi 5 octobre 2026 ; le 11 novembre (mercredi) est férié.
const range = (startDay: string, startHalf: 'am' | 'pm', endDay: string, endHalf: 'am' | 'pm') => ({
  startDay,
  startHalf,
  endDay,
  endHalf,
});

describe('demi-journées ouvrées', () => {
  it('compte les demi-journées en sautant week-ends et fériés', () => {
    expect(slotWorkingDays(range('2026-10-05', 'am', '2026-10-05', 'pm'))).toBe(1);
    expect(slotWorkingDays(range('2026-10-05', 'pm', '2026-10-07', 'am'))).toBe(2);
    // Jeudi → mardi : 4 jours ouvrés (le week-end ne compte pas).
    expect(slotWorkingDays(range('2026-10-08', 'am', '2026-10-13', 'pm'))).toBe(4);
    expect(slotWorkingDays(range('2026-11-10', 'am', '2026-11-12', 'pm'))).toBe(2);
    expect(slotHalfDays(range('2026-10-10', 'am', '2026-10-11', 'pm'))).toEqual([]);
    expect(isValidRange(range('2026-10-05', 'pm', '2026-10-05', 'am'))).toBe(false);
    expect(slotHalfDays(range('2026-10-05', 'pm', '2026-10-05', 'am'))).toEqual([]);
  });

  it('déplacer garde la durée ; un samedi glisse au lundi', () => {
    const three = range('2026-10-05', 'am', '2026-10-07', 'pm');
    expect(moveSlot(three, { day: '2026-10-08', half: 'am' })).toEqual(
      range('2026-10-08', 'am', '2026-10-12', 'pm'),
    );
    expect(moveSlot(three, { day: '2026-10-10', half: 'am' })).toEqual(
      range('2026-10-12', 'am', '2026-10-14', 'pm'),
    );
    expect(
      moveSlot(range('2026-10-05', 'am', '2026-10-05', 'am'), { day: '2026-10-09', half: 'pm' }),
    ).toEqual(range('2026-10-09', 'pm', '2026-10-09', 'pm'));
    expect(resizeSlot(three, 3)).toEqual(range('2026-10-05', 'am', '2026-10-06', 'am'));
    expect(resizeSlot(three, 0)).toEqual(range('2026-10-05', 'am', '2026-10-05', 'am'));
  });
});

describe('conflits', () => {
  const teamMembers = new Map([['team-k', ['karim', 'luca']]]);
  it('double affectation par l’équipe et en direct, congé', () => {
    const conflicts = detectConflicts({
      slots: [
        {
          id: 's1',
          projectId: 'dupont',
          teamId: 'team-k',
          employeeId: null,
          ...range('2026-10-05', 'am', '2026-10-06', 'pm'),
        },
        {
          id: 's2',
          projectId: 'lemaire',
          teamId: null,
          employeeId: 'luca',
          ...range('2026-10-06', 'pm', '2026-10-06', 'pm'),
        },
        // Même chantier deux fois : pas un conflit.
        {
          id: 's3',
          projectId: 'dupont',
          teamId: null,
          employeeId: 'karim',
          ...range('2026-10-05', 'am', '2026-10-05', 'am'),
        },
      ],
      absences: [{ employeeId: 'karim', startsOn: '2026-10-06', endsOn: '2026-10-06', halfDay: 'am' }],
      teamMembers,
    });
    expect(conflicts).toEqual([
      { kind: 'absence', employeeId: 'karim', day: '2026-10-06', half: 'am', slotIds: ['s1'] },
      { kind: 'double_booking', employeeId: 'luca', day: '2026-10-06', half: 'pm', slotIds: ['s1', 's2'] },
    ]);
  });

  it('date de début : première demi-journée ouvrée planifiée', () => {
    expect(
      firstPlannedDay([
        range('2026-10-12', 'am', '2026-10-13', 'pm'),
        range('2026-10-10', 'am', '2026-10-12', 'am'),
      ]),
    ).toBe('2026-10-12');
    expect(firstPlannedDay([])).toBeNull();
  });
});

describe('iCal', () => {
  it('un événement par jour ouvré, heures de Bruxelles, texte échappé et lignes pliées', () => {
    const ics = buildICal({
      name: 'Planning — Luca Rossi',
      now: new Date('2026-10-01T10:00:00Z'),
      events: [
        {
          uid: 'slot-1',
          range: range('2026-10-09', 'pm', '2026-10-12', 'am'),
          summary: 'Rénovation salle de bain Dupont, CH2026-025',
          location: 'Rue de la Station 42; 6040 Jumet',
          description: `Équipe Karim\n${'Très longue consigne '.repeat(6)}`,
          updatedAt: new Date('2026-10-01T09:00:00Z'),
        },
      ],
    });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2); // vendredi après-midi, lundi matin
    expect(ics).toContain('DTSTART:20261009T103000Z'); // 12 h 30 à Bruxelles (heure d'été)
    expect(ics).toContain('DTEND:20261009T143000Z');
    expect(ics).toContain('DTSTART:20261012T060000Z');
    expect(ics).toContain('UID:slot-1-2026-10-12@batimint');
    expect(ics).toContain('SUMMARY:Rénovation salle de bain Dupont\\, CH2026-025');
    expect(ics).toContain('LOCATION:Rue de la Station 42\\; 6040 Jumet');
    for (const line of ics.split('\r\n')) expect(utf8Length(line)).toBeLessThanOrEqual(75);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});
