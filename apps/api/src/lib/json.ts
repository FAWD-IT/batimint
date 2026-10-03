/**
 * Sérialisation JSON de l'API : bigint (centimes) → nombre entier, Decimal → chaîne, Date → ISO.
 * Un montant hors de la plage sûre déclenche une erreur plutôt qu'une perte de précision.
 */
export function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error('Montant hors plage sûre pour JSON');
    }
    return Number(value);
  }
  if (value && typeof value === 'object' && 'toFixed' in value && 'd' in value && 'e' in value) {
    return (value as { toString(): string }).toString();
  }
  return value;
}

export function toJson(value: unknown): string {
  return JSON.stringify(value, jsonReplacer);
}
