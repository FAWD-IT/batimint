import { describe, expect, it } from 'vitest';
import {
  ALL_MACHINES,
  assertTransition,
  canTransition,
  IllegalTransitionError,
  InvoiceStatus,
  isInvoiceEditable,
  nextStates,
  ProjectStatus,
  QuoteStatus,
  type StateMachine,
} from './state-machine';

describe('04 — cycles de vie', () => {
  it('chaque machine est cohérente (états connus, terminaux sans sortie)', () => {
    for (const m of ALL_MACHINES as readonly StateMachine<string>[]) {
      expect(m.states).toContain(m.initial);
      for (const [from, tos] of Object.entries(m.transitions) as [string, readonly string[]][]) {
        expect(m.states).toContain(from);
        for (const to of tos) expect(m.states).toContain(to);
      }
      for (const s of m.states) expect(m.transitions[s]).toBeDefined();
    }
  });

  it('teste exhaustivement chaque couple d’états', () => {
    for (const m of ALL_MACHINES as readonly StateMachine<string>[]) {
      for (const from of m.states) {
        for (const to of m.states) {
          const allowed = m.transitions[from]!.includes(to);
          expect(canTransition(m, from, to)).toBe(allowed);
          if (allowed) expect(assertTransition(m, from, to)).toBe(to);
          else expect(() => assertTransition(m, from, to)).toThrow(IllegalTransitionError);
        }
      }
    }
  });

  it('devis : brouillon → envoyé → vu → signé ; un devis signé ne bouge plus', () => {
    expect(canTransition(QuoteStatus, 'draft', 'sent')).toBe(true);
    expect(canTransition(QuoteStatus, 'sent', 'viewed')).toBe(true);
    expect(canTransition(QuoteStatus, 'viewed', 'signed')).toBe(true);
    expect(nextStates(QuoteStatus, 'signed')).toEqual([]);
    expect(canTransition(QuoteStatus, 'draft', 'signed')).toBe(false);
  });

  it('chantier : en cours ⇄ suspendu, puis réceptions et clôture', () => {
    expect(canTransition(ProjectStatus, 'in_progress', 'suspended')).toBe(true);
    expect(canTransition(ProjectStatus, 'suspended', 'in_progress')).toBe(true);
    expect(canTransition(ProjectStatus, 'in_progress', 'closed')).toBe(false);
    expect(canTransition(ProjectStatus, 'final_acceptance', 'closed')).toBe(true);
  });

  it('facture : une facture émise est immuable et ne revient jamais en brouillon (règle n°4)', () => {
    for (const s of InvoiceStatus.states) {
      expect(canTransition(InvoiceStatus, s, 'draft')).toBe(false);
      expect(isInvoiceEditable(s)).toBe(s === 'draft');
    }
    const err = (() => {
      try {
        assertTransition(InvoiceStatus, 'paid', 'issued');
      } catch (e) {
        return e as IllegalTransitionError;
      }
      return null;
    })();
    expect(err?.machine).toBe('invoice');
    expect(err?.message).toContain('paid → issued');
  });
});
