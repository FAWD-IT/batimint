import { normalizeEnterpriseNumber } from '@batimint/domain';
import type { VatValidationResult, VatValidator } from './types';

/**
 * API REST publique VIES de la Commission européenne, avec cache mémoire et tolérance aux pannes :
 * en cas d'indisponibilité, on renvoie source = « unavailable » au lieu d'échouer.
 */
export class ViesVatValidator implements VatValidator {
  readonly provider = 'vies';
  private readonly cache = new Map<string, { at: number; result: VatValidationResult }>();

  constructor(
    private readonly baseUrl = 'https://ec.europa.eu/taxation_customs/vies/rest-api',
    private readonly ttlMs = 24 * 3600 * 1000,
    private readonly timeoutMs = 6000,
  ) {}

  async validate(vatNumber: string): Promise<VatValidationResult> {
    const cleaned = vatNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const country = /^[A-Z]{2}/.test(cleaned) ? cleaned.slice(0, 2) : 'BE';
    const number = country === 'BE' ? (normalizeEnterpriseNumber(cleaned) ?? cleaned) : cleaned.slice(2);
    const key = `${country}${number}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < this.ttlMs) return cached.result;
    try {
      const res = await fetch(`${this.baseUrl}/ms/${country}/vat/${number}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`VIES HTTP ${res.status}`);
      const body = (await res.json()) as { isValid?: boolean; name?: string; address?: string };
      const raw = body.address && body.address !== '---' ? body.address.replace(/\n/g, ', ').trim() : null;
      const match = raw?.match(/^(.*?),?\s*(\d{4})\s+(.+)$/);
      const result: VatValidationResult = {
        vatNumber: key,
        valid: Boolean(body.isValid),
        name: body.name && body.name !== '---' ? body.name : null,
        address: raw
          ? { street: match?.[1]?.trim() ?? null, postalCode: match?.[2] ?? null, city: match?.[3]?.trim() ?? null, raw }
          : null,
        checkedAt: new Date(),
        source: 'vies',
      };
      this.cache.set(key, { at: Date.now(), result });
      return result;
    } catch {
      return { vatNumber: key, valid: false, name: null, address: null, checkedAt: new Date(), source: 'unavailable' };
    }
  }
}
