import { normalizeEnterpriseNumber } from '@batimint/domain';
import { createHash } from 'node:crypto';
import { IntegrationError } from '../errors';
import type { ThirtyBisChecker, ThirtyBisCheckResult } from './thirty-bis';

/** Sous-traitants fictifs du seed avec une dette (« Façades Lemaire » : dette sociale). */
const KNOWN_DEBTORS: Record<string, { social: bigint | null; tax: bigint | null }> = {
  '0899123286': { social: 1_845_000n, tax: null },
};

/**
 * Mock déterministe pour tester les deux chemins (05 §7) : selon les deux derniers chiffres du
 * numéro avant le contrôle (positions 7 et 8), « 99 » = dette sociale, « 98 » = dette fiscale,
 * « 97 » = les deux ; tout autre numéro est sans dette.
 */
export function mockThirtyBisDebts(
  enterpriseNumber: string,
): { social: bigint | null; tax: bigint | null } | null {
  const known = KNOWN_DEBTORS[enterpriseNumber];
  if (known) return known;
  const tail = enterpriseNumber.slice(6, 8);
  if (tail === '99') return { social: 2_500_000n, tax: null };
  if (tail === '98') return { social: null, tax: 900_000n };
  if (tail === '97') return { social: 2_500_000n, tax: 900_000n };
  return null;
}

export class MockThirtyBisChecker implements ThirtyBisChecker {
  readonly provider = 'mock';
  readonly checks: ThirtyBisCheckResult[] = [];

  async check(input: string): Promise<ThirtyBisCheckResult> {
    const enterpriseNumber = normalizeEnterpriseNumber(input);
    if (!enterpriseNumber)
      throw new IntegrationError('mock', `Numéro d'entreprise illisible : « ${input} ».`, false);
    const debts = mockThirtyBisDebts(enterpriseNumber);
    const checkedAt = new Date();
    const reference = `30BIS-${createHash('sha256')
      .update(`${enterpriseNumber}:${checkedAt.toISOString()}`)
      .digest('hex')
      .slice(0, 12)
      .toUpperCase()}`;
    const result: ThirtyBisCheckResult = {
      enterpriseNumber,
      hasSocialDebt: Boolean(debts?.social !== undefined && debts?.social !== null),
      hasTaxDebt: Boolean(debts?.tax !== undefined && debts?.tax !== null),
      socialDebtAmount: debts?.social ?? null,
      taxDebtAmount: debts?.tax ?? null,
      checkedAt,
      proof: {
        reference,
        service: 'Simulation ONSS / SPF Finances (mock)',
        response: {
          enterpriseNumber,
          socialDebt: debts?.social ? 'oui' : 'non',
          taxDebt: debts?.tax ? 'oui' : 'non',
          consultedAt: checkedAt.toISOString(),
        },
      },
    };
    this.checks.push(result);
    return result;
  }
}
