/**
 * Numérotation légale sans trou (05 §2, règle n°4). L'incrément se fait par UPSERT dans la
 * transaction de l'émission : la ligne reste verrouillée jusqu'au commit, et un rollback
 * annule l'incrément. Résultat : aucune émission concurrente ne crée de trou ni de doublon.
 */
import type { Tx } from './client';

export async function nextSequenceValue(tx: Tx, tenantId: string, docType: string, year: number): Promise<number> {
  const rows = await tx.$queryRaw<{ last_value: number }[]>`
    INSERT INTO number_sequences (tenant_id, doc_type, year, last_value, updated_at)
    VALUES (${tenantId}::uuid, ${docType}, ${year}, 1, now())
    ON CONFLICT (tenant_id, doc_type, year)
    DO UPDATE SET last_value = number_sequences.last_value + 1, updated_at = now()
    RETURNING last_value`;
  const value = rows[0]?.last_value;
  if (value === undefined) throw new Error('Allocation de numéro impossible');
  return Number(value);
}
