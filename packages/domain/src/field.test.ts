import { describe, expect, it } from 'vitest';
import {
  allocateLabour,
  checkGeofence,
  computeWorkedTime,
  distanceMeters,
  formatMinutes,
  labourCost,
  requiresCheckInOut,
} from './field';

const JUMET = { latitude: 50.4405, longitude: 4.4311 };
const t = (hhmm: string) => new Date(`2026-10-01T${hhmm}:00+02:00`);

describe('géolocalisation du pointage', () => {
  it('mesure la distance à vol d’oiseau', () => {
    const charleroi = { latitude: 50.4108, longitude: 4.4446 };
    expect(Math.trunc(distanceMeters(JUMET, charleroi) / 100)).toBe(34); // ≈ 3,4 km
    expect(distanceMeters(JUMET, JUMET)).toBe(0);
  });

  it('accepte dans la tolérance, élargie par la précision annoncée', () => {
    const near = { latitude: 50.4415, longitude: 4.4311, accuracy: 10 }; // ≈ 111 m
    expect(checkGeofence({ site: JUMET, position: near, toleranceMeters: 300 })).toEqual({
      status: 'ok',
      distance: 111,
    });
    expect(
      checkGeofence({ site: JUMET, position: { ...near, accuracy: 5 }, toleranceMeters: 100 }).status,
    ).toBe('too_far');
    expect(
      checkGeofence({ site: JUMET, position: { ...near, accuracy: 30 }, toleranceMeters: 100 }).status,
    ).toBe('ok');
    expect(checkGeofence({ site: JUMET, position: null, toleranceMeters: 300 }).status).toBe('no_position');
    expect(checkGeofence({ site: null, position: near, toleranceMeters: 300 }).status).toBe(
      'no_site_position',
    );
  });
});

describe('heures prestées', () => {
  const opts = { breakMinutes: 30, breakAfterMinutes: 360 };
  it('une journée de 8 h avec pause de 30 min', () => {
    const w = computeWorkedTime(
      [
        { id: 'a', kind: 'in', at: t('08:02') },
        { id: 'b', kind: 'out', at: t('16:32') },
      ],
      opts,
    );
    expect(w).toMatchObject({
      grossMinutes: 510,
      breakMinutes: 30,
      netMinutes: 480,
      openSince: null,
      anomalies: [],
    });
  });

  it('pas de pause sous le seuil, plusieurs sessions additionnées', () => {
    const w = computeWorkedTime(
      [
        { id: 'c', kind: 'in', at: t('13:00') },
        { id: 'a', kind: 'in', at: t('08:00') },
        { id: 'b', kind: 'out', at: t('11:00') },
        { id: 'd', kind: 'out', at: t('15:30') },
      ],
      opts,
    );
    expect(w.sessions.map((s) => s.minutes)).toEqual([180, 150]);
    expect(w).toMatchObject({ grossMinutes: 330, breakMinutes: 0, netMinutes: 330 });
  });

  it('journée en cours et pointages incohérents signalés', () => {
    const w = computeWorkedTime(
      [
        { id: 'x', kind: 'out', at: t('07:00') },
        { id: 'a', kind: 'in', at: t('08:00') },
        { id: 'b', kind: 'in', at: t('08:05') },
      ],
      { ...opts, now: t('10:05') },
    );
    expect(w.openSince).toEqual(t('08:05'));
    expect(w.sessions.at(-1)!.minutes).toBe(120);
    expect(w.netMinutes).toBe(0);
    expect(w.anomalies).toEqual(['out_without_in', 'double_in']);
  });

  it('coût main-d’œuvre au centime', () => {
    expect(labourCost(480, 4400n)).toBe(35_200n);
    expect(labourCost(25, 3650n)).toBe(1521n); // 1 520,83 → 1 521
    expect(labourCost(0, 4400n)).toBe(0n);
    expect(formatMinutes(480)).toBe('8 h');
    expect(formatMinutes(455)).toBe('7 h 35');
  });
});

describe('répartition du coût sur les postes', () => {
  it('sur les postes touchés ce jour-là, sinon au prorata du reste à faire', () => {
    const posts = [
      { id: 'demo', plannedHours: 10, progress: 1 },
      { id: 'plomb', plannedHours: 40, progress: '0.5' },
      { id: 'carr', plannedHours: 20, progress: 0 },
    ];
    expect(allocateLabour(10_000n, posts)).toEqual([
      { budgetLineId: 'plomb', amount: 5_000n },
      { budgetLineId: 'carr', amount: 5_000n },
    ]);
    expect(
      allocateLabour(
        10_000n,
        posts.map((p) => ({ ...p, touchedToday: p.id === 'carr' })),
      ),
    ).toEqual([{ budgetLineId: 'carr', amount: 10_000n }]);
    expect(allocateLabour(10_000n, [{ id: 'x', plannedHours: 0, progress: 0 }])).toEqual([]);
    expect(allocateLabour(0n, posts)).toEqual([]);
  });
});

describe('Check In and Out at Work', () => {
  it('à partir de 500 000 € HTVA sur le chantier entier', () => {
    expect(requiresCheckInOut({ contractAmount: 50_000_000n })).toBe(true);
    expect(requiresCheckInOut({ contractAmount: 49_999_999n })).toBe(false);
    expect(requiresCheckInOut({ contractAmount: 10_000_000n, workplaceTotalAmount: 80_000_000n })).toBe(true);
  });
});
