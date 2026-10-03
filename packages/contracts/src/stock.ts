/**
 * Stock et matériel (03 §11, 02 P13) : emplacements, niveaux et seuils, mouvements au coût moyen
 * pondéré, réapprovisionnement, matériel affecté aux chantiers, entretiens et contrôles.
 */
import { z } from 'zod';
import { CentsSchema, DecimalString, Uuid } from './common';

const IsoDay = z.iso.date();

export const StockLocationSchema = z.object({
  id: Uuid,
  name: z.string(),
  kind: z.enum(['depot', 'van']),
  address: z.string().nullable(),
  employee: z.object({ id: Uuid, name: z.string() }).nullable(),
  itemCount: z.number().int(),
  value: CentsSchema,
  lowCount: z.number().int(),
});
export type StockLocationDto = z.infer<typeof StockLocationSchema>;

export const StockLocationInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(['depot', 'van']),
  address: z.string().trim().max(200).nullable().optional(),
  employeeId: Uuid.nullable().optional(),
});

export const StockLevelSchema = z.object({
  locationId: Uuid,
  quantity: DecimalString,
  minQuantity: DecimalString.nullable(),
  reorderQuantity: DecimalString.nullable(),
  below: z.boolean(),
});

export const StockItemSchema = z.object({
  item: z.object({ id: Uuid, code: z.string(), name: z.string(), unit: z.string() }),
  averageCost: CentsSchema,
  quantity: DecimalString,
  value: CentsSchema,
  levels: z.array(StockLevelSchema),
});
export type StockItemDto = z.infer<typeof StockItemSchema>;

export const StockLevelInputSchema = z.object({
  locationId: Uuid,
  itemId: Uuid,
  minQuantity: DecimalString.nullable(),
  reorderQuantity: DecimalString.nullable(),
});

export const StockMovementKindSchema = z.enum(['in', 'out', 'transfer', 'adjustment']);

export const StockMovementInputSchema = z
  .object({
    /** UUIDv7 du client : un renvoi ne crée pas de doublon (hors ligne). */
    id: Uuid,
    kind: StockMovementKindSchema,
    itemId: Uuid,
    locationId: Uuid,
    /** Entrée, sortie, transfert : quantité ; inventaire : quantité comptée. */
    quantity: DecimalString,
    unitCost: CentsSchema.min(0).nullable().optional(),
    toLocationId: Uuid.nullable().optional(),
    projectId: Uuid.nullable().optional(),
    budgetLineId: Uuid.nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((m) => m.kind !== 'out' || Boolean(m.projectId), {
    error: 'Une sortie de stock est imputée à un chantier.',
    path: ['projectId'],
  })
  .refine((m) => m.kind !== 'transfer' || (Boolean(m.toLocationId) && m.toLocationId !== m.locationId), {
    error: 'Choisissez l’emplacement de destination.',
    path: ['toLocationId'],
  });
export type StockMovementInput = z.input<typeof StockMovementInputSchema>;

export const StockMovementSchema = z.object({
  id: Uuid,
  kind: StockMovementKindSchema,
  item: z.object({ id: Uuid, code: z.string(), name: z.string(), unit: z.string() }),
  quantity: DecimalString,
  unitCost: CentsSchema,
  totalCost: CentsSchema,
  location: z.object({ id: Uuid, name: z.string() }),
  toLocation: z.object({ id: Uuid, name: z.string() }).nullable(),
  project: z.object({ id: Uuid, number: z.string(), name: z.string() }).nullable(),
  note: z.string().nullable(),
  occurredAt: z.string(),
  by: z.string().nullable(),
});
export type StockMovementDto = z.infer<typeof StockMovementSchema>;

export const ReorderProposalSchema = z.object({
  groups: z.array(
    z.object({
      supplier: z.object({ id: Uuid, name: z.string() }).nullable(),
      location: z.object({ id: Uuid, name: z.string() }),
      lines: z.array(
        z.object({
          itemId: Uuid,
          code: z.string(),
          name: z.string(),
          unit: z.string(),
          quantity: DecimalString,
          stock: DecimalString,
          minQuantity: DecimalString,
          unitPrice: CentsSchema,
        }),
      ),
      total: CentsSchema,
    }),
  ),
});
export type ReorderProposalDto = z.infer<typeof ReorderProposalSchema>;

export const ReorderOrderInputSchema = z.object({
  id: Uuid,
  supplierId: Uuid,
  locationId: Uuid,
  lines: z
    .array(z.object({ itemId: Uuid, quantity: DecimalString, unitPrice: CentsSchema.min(0) }))
    .min(1)
    .max(200),
});

/* ------------------------------------------------------------------------------------------ */
/* Matériel                                                                                   */

export const MaintenanceStatusSchema = z.enum(['ok', 'due_soon', 'overdue']);

export const MaintenanceSchema = z.object({
  id: Uuid,
  kind: z.enum(['maintenance', 'inspection']),
  label: z.string(),
  dueOn: IsoDay,
  doneOn: IsoDay.nullable(),
  intervalMonths: z.number().int().nullable(),
  cost: CentsSchema.nullable(),
  notes: z.string().nullable(),
  status: MaintenanceStatusSchema.nullable(),
});
export type MaintenanceDto = z.infer<typeof MaintenanceSchema>;

export const EquipmentAssignmentSchema = z.object({
  id: Uuid,
  project: z.object({ id: Uuid, number: z.string(), name: z.string() }),
  budgetLine: z.object({ id: Uuid, label: z.string() }).nullable(),
  startDate: IsoDay,
  endDate: IsoDay.nullable(),
  dailyCost: CentsSchema,
  days: z.number().int(),
  cost: CentsSchema,
});
export type EquipmentAssignmentDto = z.infer<typeof EquipmentAssignmentSchema>;

export const EquipmentSchema = z.object({
  id: Uuid,
  code: z.string().nullable(),
  name: z.string(),
  category: z.string().nullable(),
  serialNumber: z.string().nullable(),
  dailyCost: CentsSchema,
  purchasedOn: IsoDay.nullable(),
  notes: z.string().nullable(),
  current: EquipmentAssignmentSchema.nullable(),
  nextMaintenance: MaintenanceSchema.nullable(),
  assignments: z.array(EquipmentAssignmentSchema),
  maintenance: z.array(MaintenanceSchema),
});
export type EquipmentDto = z.infer<typeof EquipmentSchema>;

export const EquipmentSummarySchema = EquipmentSchema.omit({ assignments: true, maintenance: true });
export type EquipmentSummaryDto = z.infer<typeof EquipmentSummarySchema>;

export const EquipmentInputSchema = z.object({
  id: Uuid,
  code: z.string().trim().max(30).nullable().optional(),
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().max(60).nullable().optional(),
  serialNumber: z.string().trim().max(60).nullable().optional(),
  dailyCost: CentsSchema.min(0),
  purchasedOn: IsoDay.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const AssignmentInputSchema = z.object({
  id: Uuid,
  projectId: Uuid,
  budgetLineId: Uuid.nullable().optional(),
  startDate: IsoDay,
  endDate: IsoDay.nullable().optional(),
});

export const MaintenanceInputSchema = z.object({
  id: Uuid,
  kind: z.enum(['maintenance', 'inspection']),
  label: z.string().trim().min(2).max(120),
  dueOn: IsoDay,
  intervalMonths: z.number().int().min(1).max(120).nullable().optional(),
});

export const MaintenanceDoneSchema = z.object({
  doneOn: IsoDay,
  cost: CentsSchema.min(0).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
