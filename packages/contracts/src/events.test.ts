import { describe, expect, it } from 'vitest';
import { EVENT_TYPES, isKnownEventType, parseEventPayload } from './events';
import { Email, SignupRequestSchema } from './index';

describe('contrats', () => {
  it('les types d’événements sont versionnés', () => {
    for (const t of EVENT_TYPES) expect(t).toMatch(/^[a-z_]+(\.[a-z_]+)+\.v\d+$/);
    expect(isKnownEventType('diagnostic.ping.v1')).toBe(true);
    expect(isKnownEventType('nope.v1')).toBe(false);
  });

  it('valide les payloads', () => {
    expect(() => parseEventPayload('diagnostic.ping.v1', { requestedBy: 'x', message: 'a' })).toThrow();
    expect(
      parseEventPayload('diagnostic.ping.v1', { requestedBy: '0199a0a0-0000-7000-8000-000000000000', message: 'a' }).message,
    ).toBe('a');
  });

  it('normalise les e-mails et exige un mot de passe robuste', () => {
    expect(Email.parse('  Marc@Renov.BE ')).toBe('marc@renov.be');
    const r = SignupRequestSchema.safeParse({ companyName: 'R', name: 'Marc', email: 'marc@x.be', password: 'court' });
    expect(r.success).toBe(false);
  });
});
