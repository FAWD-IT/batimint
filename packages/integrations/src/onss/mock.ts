import { createHash } from 'node:crypto';
import { IntegrationError } from '../errors';
import type { AttendanceRegistry, PresenceInput, PresenceReceipt, Workplace } from './types';

/**
 * Mock déterministe : un lieu de travail par référence ; une présence sans INSS est refusée
 * (comme le ferait l'ONSS), pour tester l'échec visible et rejouable.
 */
export class MockAttendanceRegistry implements AttendanceRegistry {
  readonly provider = 'mock';
  readonly presences: (PresenceInput & PresenceReceipt)[] = [];
  private readonly workplaces = new Map<string, string>();

  async declareWorkplace(workplace: Workplace): Promise<{ workplaceId: string }> {
    let id = this.workplaces.get(workplace.reference);
    if (!id) {
      id = `WP-${createHash('sha256').update(workplace.reference).digest('hex').slice(0, 10).toUpperCase()}`;
      this.workplaces.set(workplace.reference, id);
    }
    return { workplaceId: id };
  }

  async registerPresence(input: PresenceInput): Promise<PresenceReceipt> {
    if (!input.worker.inss && !input.worker.isSelfEmployed)
      throw new IntegrationError(
        'mock',
        `Présence refusée : le numéro INSS de ${input.worker.name} est manquant dans sa fiche.`,
        false,
      );
    const receipt = {
      reference: `CIO-${createHash('sha256')
        .update(`${input.workplaceId}:${input.worker.employeeId}:${input.kind}:${input.at.toISOString()}`)
        .digest('hex')
        .slice(0, 12)
        .toUpperCase()}`,
      registeredAt: new Date(),
    };
    this.presences.push({ ...input, ...receipt });
    return receipt;
  }
}
