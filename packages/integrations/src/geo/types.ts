/**
 * Géocodage des adresses de chantier (03 §5 « vue carte ») : position et précision. Une position
 * approximative (localité, région) sert à la carte, jamais au contrôle de présence (géorepérage).
 */
export interface GeocodeInput {
  street: string;
  postalCode: string;
  city: string;
  country?: string;
}

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  precision: 'address' | 'locality' | 'region';
}

export interface Geocoder {
  readonly provider: string;
  geocode(input: GeocodeInput): Promise<GeocodeResult | null>;
}
