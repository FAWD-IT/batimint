/**
 * ONSS — Check In and Out at Work (05 §8, 07) : enregistrement des présences IN/OUT sur les
 * chantiers ≥ 500 000 € HTVA. Les modalités d'accès logiciel restent [à valider] : mock + export.
 */

export interface Workplace {
  /** Référence interne du chantier (numéro). */
  reference: string;
  name: string;
  address: string;
  postalCode: string;
  city: string;
  startDate: string | null;
  endDate: string | null;
  contractor: { enterpriseNumber: string | null; name: string };
}

export interface PresenceInput {
  kind: 'in' | 'out';
  at: Date;
  /** Identifiant ONSS du lieu de travail (renvoyé par declareWorkplace). */
  workplaceId: string;
  worker: { employeeId: string; name: string; inss: string | null; isSelfEmployed: boolean };
}

export interface PresenceReceipt {
  reference: string;
  registeredAt: Date;
}

export interface AttendanceRegistry {
  readonly provider: string;
  declareWorkplace(workplace: Workplace): Promise<{ workplaceId: string }>;
  registerPresence(input: PresenceInput): Promise<PresenceReceipt>;
}
