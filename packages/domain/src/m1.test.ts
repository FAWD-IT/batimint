import { describe, expect, it } from 'vitest';
import { formatInss, isValidInss, normalizeInss } from './belgium';
import { contrastRatio, normalizeHex, passesAA, portalAccent, relativeLuminance } from './color';
import { onboardingChecklist } from './onboarding';
import { billableSeats, enabledFeatures, isFeatureEnabled, trialDaysLeft } from './plans';

describe('plans et modules', () => {
  it('chaque plan inclut le précédent', () => {
    expect(isFeatureEnabled('essential', {}, 'quotes')).toBe(true);
    expect(isFeatureEnabled('essential', {}, 'stock')).toBe(false);
    expect(isFeatureEnabled('pro', {}, 'planning')).toBe(true);
    expect(isFeatureEnabled('expert', null, 'stock')).toBe(true);
  });
  it('les drapeaux surchargent le plan ; « all » active tout (démo)', () => {
    expect(isFeatureEnabled('essential', { stock: true }, 'stock')).toBe(true);
    expect(isFeatureEnabled('expert', { ai_assistant: false }, 'ai_assistant')).toBe(false);
    expect(enabledFeatures('essential', { all: true })).toHaveLength(17);
  });
  it('les ouvriers et chefs de chantier ne sont pas facturés', () => {
    expect(billableSeats(['owner', 'office', 'worker', 'worker', 'site_manager', 'accountant'])).toBe(3);
  });
  it('jours d’essai restants', () => {
    const now = new Date('2026-10-01T10:00:00Z');
    expect(trialDaysLeft(new Date('2026-10-15T10:00:00Z'), now)).toBe(14);
    expect(trialDaysLeft(new Date('2026-09-01T00:00:00Z'), now)).toBe(0);
    expect(trialDaysLeft(null, now)).toBeNull();
  });
});

describe('08 — couleur de marque et contraste AA', () => {
  it('normalise les couleurs', () => {
    expect(normalizeHex('2f4bff')).toBe('#2F4BFF');
    expect(normalizeHex('#abc')).toBe('#AABBCC');
    expect(normalizeHex('bleu')).toBeNull();
    expect(() => relativeLuminance('xyz')).toThrow();
  });
  it('calcule le ratio WCAG', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });
  it('n’utilise la couleur du tenant que si elle est lisible', () => {
    expect(passesAA('#2F4BFF')).toBe(true);
    expect(passesAA('#FFD400')).toBe(false);
    expect(passesAA('nope')).toBe(false);
    expect(portalAccent('#0B6E4F')).toBe('#0B6E4F');
    expect(portalAccent('#FFD400')).toBe('#2F4BFF');
    expect(portalAccent(null)).toBe('#2F4BFF');
  });
});

describe('02 P1.7 — checklist d’onboarding', () => {
  const empty = {
    vatValidated: false,
    hasAddress: false,
    hasIban: false,
    hasLogo: false,
    hasTerms: false,
    hasHourlyRates: false,
    libraryItemCount: 0,
    peppolStatus: 'not_connected' as const,
    invitedOrMembers: 1,
  };
  it('rien de fait au départ, chaque étape a un lien', () => {
    const c = onboardingChecklist(empty);
    expect(c.completed).toBe(0);
    expect(c.complete).toBe(false);
    expect(c.steps.every((s) => s.href.startsWith('/'))).toBe(true);
  });
  it('complète quand tout est fait', () => {
    const c = onboardingChecklist({
      vatValidated: true,
      hasAddress: true,
      hasIban: true,
      hasLogo: true,
      hasTerms: true,
      hasHourlyRates: true,
      libraryItemCount: 12,
      peppolStatus: 'active',
      invitedOrMembers: 4,
    });
    expect(c.complete).toBe(true);
  });
  it('ne compte que les étapes disponibles', () => {
    expect(onboardingChecklist(empty, ['company', 'bank']).total).toBe(2);
  });
});

describe('INSS (Check In and Out, 05 §8-9)', () => {
  it('valide le contrôle mod 97, avant et après 2000', () => {
    // 85073003328 : 850730033 mod 97 = 69 → 97 − 69 = 28
    expect(isValidInss('85.07.30-033.28')).toBe(true);
    expect(isValidInss('85.07.30-033.29')).toBe(false);
    // Né en 2001 : contrôle calculé sur 2 + 9 chiffres
    const base = '010203123';
    const check = (97 - (Number(`2${base}`) % 97)).toString().padStart(2, '0');
    expect(isValidInss(`${base}${check}`)).toBe(true);
    expect(isValidInss('123')).toBe(false);
    expect(normalizeInss('85.07.30-033.28')).toBe('85073003328');
    expect(formatInss('85073003328')).toBe('85.07.30-033.28');
    expect(formatInss('x')).toBe('x');
  });
});
