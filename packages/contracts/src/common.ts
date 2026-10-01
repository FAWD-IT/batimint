import { ACTIONS, ROLES } from '@batimint/domain';
import { z } from 'zod';

export const Uuid = z.uuid();
export const RoleSchema = z.enum(ROLES);
export const ActionSchema = z.enum(ACTIONS);

/** Montant en centimes, transmis en JSON comme entier (sûr jusqu'à 2^53). */
export const CentsSchema = z.number().int().meta({ description: 'Montant en centimes d’euro (entier).' });

/** Quantité ou taux décimal, transmis en chaîne pour rester exact (« 12.5 »). */
export const DecimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'Nombre décimal attendu')
  .meta({ description: 'Nombre décimal exact (chaîne).' });

export const Email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: 'Adresse e-mail invalide' }));

export const ErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
      requestId: z.string().optional(),
    }),
  })
  .meta({ id: 'ErrorResponse' });
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const CursorQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function paginated<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}

export const OkSchema = z.object({ ok: z.literal(true) });
