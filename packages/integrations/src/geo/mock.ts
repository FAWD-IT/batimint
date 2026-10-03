/**
 * Géocodage simulé (déterministe, sans réseau) : le code postal belge situe la province, puis un
 * décalage stable dérivé du code postal place la localité à quelques kilomètres. Précision
 * « locality » au mieux : jamais utilisée pour le géorepérage.
 */
import type { GeocodeInput, GeocodeResult, Geocoder } from './types';

/** Centres approximatifs par tranche de codes postaux (bpost). */
const RANGES: [number, number, number, number][] = [
  [1000, 1299, 50.8466, 4.3528], // Bruxelles
  [1300, 1499, 50.6687, 4.6121], // Brabant wallon
  [1500, 1999, 50.8786, 4.4214], // Brabant flamand (ouest)
  [2000, 2999, 51.2194, 4.4025], // Anvers
  [3000, 3499, 50.8798, 4.7005], // Brabant flamand (Louvain)
  [3500, 3999, 50.9307, 5.3378], // Limbourg
  [4000, 4999, 50.6326, 5.5797], // Liège
  [5000, 5999, 50.4669, 4.8675], // Namur
  [6000, 6599, 50.4108, 4.4446], // Hainaut (Charleroi)
  [6600, 6999, 49.9997, 5.7139], // Luxembourg
  [7000, 7999, 50.4542, 3.9567], // Hainaut (Mons, Tournai)
  [8000, 8999, 51.0544, 3.1004], // Flandre occidentale
  [9000, 9999, 51.0543, 3.7174], // Flandre orientale
];

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

export class MockGeocoder implements Geocoder {
  readonly provider = 'mock';

  async geocode(input: GeocodeInput): Promise<GeocodeResult | null> {
    if ((input.country ?? 'BE') !== 'BE') return null;
    const code = Number(input.postalCode.replace(/\D/g, '').slice(0, 4));
    const range = RANGES.find(([from, to]) => code >= from && code <= to);
    if (!range) return null;
    // Décalage stable de ±0,12° (≈ 10 km) par code postal : la même localité tombe au même endroit.
    const h = hash(String(code));
    const dLat = ((h % 1000) / 1000 - 0.5) * 0.24;
    const dLon = (((h >>> 10) % 1000) / 1000 - 0.5) * 0.34;
    return {
      latitude: Math.round((range[2] + dLat) * 1e6) / 1e6,
      longitude: Math.round((range[3] + dLon) * 1e6) / 1e6,
      precision: 'locality',
    };
  }
}
