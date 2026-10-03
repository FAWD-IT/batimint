/**
 * Catalogue des événements (04 « Catalogue d'événements »). Types versionnés.
 * Chaque payload est validé par zod à l'émission et à la consommation.
 */
import { z } from 'zod';
import { Uuid } from './common';

export const EventPayloads = {
  'diagnostic.ping.v1': z.object({ requestedBy: Uuid, message: z.string().max(200) }),
  'user.invited.v1': z.object({
    invitationId: Uuid,
    email: z.string(),
    role: z.string(),
    invitedBy: Uuid.nullable(),
  }),
  'tenant.created.v1': z.object({ tenantId: Uuid, ownerUserId: Uuid }),
  'tenant.updated.v1': z.object({ fields: z.array(z.string()) }),
  'member.joined.v1': z.object({ userId: Uuid, role: z.string(), invitationId: Uuid.nullable() }),
  'member.updated.v1': z.object({ membershipId: Uuid, role: z.string(), status: z.string() }),
  'lead.received.v1': z.object({ leadId: Uuid, source: z.string() }),
  'customer.created.v1': z.object({ customerId: Uuid, kind: z.string() }),
  'opportunity.created.v1': z.object({ opportunityId: Uuid, customerId: Uuid }),
  'opportunity.stage_changed.v1': z.object({ opportunityId: Uuid, from: z.string(), to: z.string() }),
  'attachment.added.v1': z.object({
    attachmentId: Uuid,
    ownerType: z.string(),
    ownerId: Uuid,
    kind: z.string(),
  }),
  'library.imported.v1': z.object({ created: z.number().int(), updated: z.number().int() }),
  'integration.updated.v1': z.object({ kind: z.string(), status: z.string(), provider: z.string() }),
  'quote.sent.v1': z.object({
    quoteId: Uuid,
    versionId: Uuid,
    version: z.number().int(),
    email: z.string(),
    message: z.string().nullable().optional(),
  }),
  'quote.expired.v1': z.object({ quoteId: Uuid }),
  'quote.viewed.v1': z.object({ quoteId: Uuid, versionId: Uuid }),
  'quote.signed.v1': z.object({
    quoteId: Uuid,
    versionId: Uuid,
    signatureId: Uuid,
    certificateSigned: z.boolean(),
  }),
  'quote.refused.v1': z.object({ quoteId: Uuid, reason: z.string().nullable() }),
  'quote.reminder_due.v1': z.object({ quoteId: Uuid }),
  'project.created.v1': z.object({ projectId: Uuid, quoteId: Uuid.nullable() }),
  'project.updated.v1': z.object({ projectId: Uuid, fields: z.array(z.string()) }),
  'project.status_changed.v1': z.object({
    projectId: Uuid,
    from: z.string(),
    to: z.string(),
    reason: z.string().nullable().optional(),
  }),
  /** Partage du portail par e-mail : le consommateur crée son propre jeton (jamais en clair dans l'outbox). */
  'project.portal_shared.v1': z.object({
    projectId: Uuid,
    email: z.string(),
    message: z.string().nullable(),
  }),
  'task.updated.v1': z.object({ projectId: Uuid, taskId: Uuid, fields: z.array(z.string()) }),
  'task.completed.v1': z.object({ projectId: Uuid, taskId: Uuid, budgetLineId: Uuid.nullable() }),
  'project.cost_recorded.v1': z.object({
    projectId: Uuid,
    costId: Uuid,
    budgetLineId: Uuid.nullable(),
    category: z.string(),
    amount: z.string(),
  }),
  'budget.drift_detected.v1': z.object({
    projectId: Uuid,
    budgetLineId: Uuid,
    committed: z.string(),
    budgetedCost: z.string(),
  }),
  'change_order.created.v1': z.object({ projectId: Uuid, changeOrderId: Uuid }),
  'change_order.sent.v1': z.object({
    projectId: Uuid,
    changeOrderId: Uuid,
    email: z.string(),
    message: z.string().nullable().optional(),
  }),
  'change_order.signed.v1': z.object({ projectId: Uuid, changeOrderId: Uuid, signatureId: Uuid }),
  'change_order.refused.v1': z.object({
    projectId: Uuid,
    changeOrderId: Uuid,
    reason: z.string().nullable(),
  }),
  'comment.added.v1': z.object({
    commentId: Uuid,
    subjectType: z.string(),
    subjectId: Uuid,
    projectId: Uuid.nullable(),
    fromClient: z.boolean(),
    mentions: z.array(Uuid),
  }),
  'time_entry.recorded.v1': z.object({
    timeEntryId: Uuid,
    projectId: Uuid,
    employeeId: Uuid,
    kind: z.enum(['in', 'out']),
    day: z.string(),
  }),
  'time_entries.validated.v1': z.object({ projectId: Uuid, day: z.string(), employeeIds: z.array(Uuid) }),
  'issue.reported.v1': z.object({ issueId: Uuid, projectId: Uuid, urgent: z.boolean() }),
  'work_order.signed.v1': z.object({ workOrderId: Uuid, projectId: Uuid, signatureId: Uuid }),
  /** Planning modifié (création, déplacement, suppression d'une affectation). */
  'schedule.changed.v1': z.object({
    projectId: Uuid,
    slotId: Uuid,
    action: z.enum(['created', 'updated', 'deleted']),
    /** Date de début du chantier mise à jour par le planning (AAAA-MM-JJ) ou null. */
    startDate: z.string().nullable(),
  }),
  /** Date de début stable depuis 10 min : à annoncer au client (portail + e-mail). */
  'project.arrival_scheduled.v1': z.object({ projectId: Uuid, startDate: z.string() }),
  /** Planning du lendemain d'une personne (envoyé à 18 h). */
  'planning.day_ahead.v1': z.object({ employeeId: Uuid, userId: Uuid, day: z.string() }),
  'purchase_order.sent.v1': z.object({
    purchaseOrderId: Uuid,
    projectId: Uuid.nullable(),
    email: z.string(),
  }),
  'purchase_order.received.v1': z.object({
    purchaseOrderId: Uuid,
    projectId: Uuid.nullable(),
    complete: z.boolean(),
  }),
  /** Facture fournisseur reçue (Peppol, dépôt, e-mail) : extraction puis rapprochement. */
  'supplier_invoice.received.v1': z.object({
    invoiceId: Uuid,
    source: z.enum(['peppol', 'upload', 'email']),
  }),
  /** Ventilée sur un ou plusieurs chantiers (automatiquement ou à la main). */
  'supplier_invoice.allocated.v1': z.object({
    invoiceId: Uuid,
    projectIds: z.array(Uuid),
    automatic: z.boolean(),
  }),
  'supplier_invoice.to_allocate.v1': z.object({ invoiceId: Uuid }),
  /** Facture fournisseur payée (retenue 30bis éventuelle déduite) : synchro compta. */
  'supplier_invoice.paid.v1': z.object({ invoiceId: Uuid }),
  /** Reprise demandée des synchronisations comptables (erreur ou attente de connexion). */
  'accounting.sync_requested.v1': z.object({ syncIds: z.array(Uuid).max(500) }),
  /** Synchronisation comptable en erreur : le bureau et le comptable sont prévenus. */
  'accounting.sync_failed.v1': z.object({ syncId: Uuid, message: z.string() }),
  /** Sous-traitant avec dettes au moment du paiement : retenue 30bis à appliquer (05 §7). */
  'supplier_invoice.blocked_thirty_bis.v1': z.object({
    invoiceId: Uuid,
    checkId: Uuid,
    social: z.string(),
    tax: z.string(),
  }),
  'supplier_invoice.withholding_applied.v1': z.object({
    invoiceId: Uuid,
    checkId: Uuid,
    social: z.string(),
    tax: z.string(),
  }),
  /** Contrat de sous-traitance conclu, modifié ou clôturé (engagé du poste, fil du chantier). */
  'subcontract.created.v1': z.object({ subcontractId: Uuid, projectId: Uuid, checkId: Uuid.nullable() }),
  'subcontract.updated.v1': z.object({
    subcontractId: Uuid,
    projectId: Uuid,
    status: z.enum(['active', 'completed', 'cancelled']),
  }),
  /** Consultation 30bis enregistrée (création, réception de facture, paiement, manuelle). */
  'thirty_bis.checked.v1': z.object({
    checkId: Uuid,
    supplierId: Uuid,
    hasDebt: z.boolean(),
    context: z.enum(['contract', 'invoice_received', 'payment', 'manual']),
  }),
  /** Document déposé par le sous-traitant sur son portail. */
  'subcontractor.document_uploaded.v1': z.object({ supplierId: Uuid, documentId: Uuid, kind: z.string() }),
  /** Accès au portail sous-traitant demandé : le worker crée le lien et l'envoie par e-mail. */
  'subcontractor.invited.v1': z.object({
    supplierId: Uuid,
    email: z.string(),
    subcontractId: Uuid.nullable(),
  }),
  /** Contrôle quotidien des échéances des documents des sous-traitants. */
  'subcontractor.document_expiring.v1': z.object({
    supplierId: Uuid,
    documentId: Uuid,
    state: z.enum(['expiring', 'expired']),
  }),
  /** PV de réception signé : statut du chantier, réserves → tâches, retenue libérée (définitive). */
  'reception.signed.v1': z.object({
    receptionId: Uuid,
    projectId: Uuid,
    kind: z.enum(['provisional', 'final']),
  }),
  /** Réserve levée (tâche faite) ; la dernière déclenche la facture finale. */
  'reserve.lifted.v1': z.object({ reserveId: Uuid, projectId: Uuid, receptionId: Uuid }),
  /** Facture finale à générer (réserves levées, ou demande du bureau). */
  'project.final_invoice_requested.v1': z.object({ projectId: Uuid }),
  'project.closed.v1': z.object({ projectId: Uuid }),
  /** Sortie de stock vers un chantier : coût imputé au poste (04 « Engagé »). */
  'stock.moved_to_project.v1': z.object({ movementId: Uuid, projectId: Uuid }),
  /** Stock passé sous son seuil (une alerte par passage). */
  'stock.level_low.v1': z.object({ levelId: Uuid, itemId: Uuid, locationId: Uuid }),
  /** Affectation de matériel créée, modifiée ou terminée : coût d'usage recalculé. */
  'equipment.assignment_changed.v1': z.object({
    assignmentId: Uuid,
    projectId: Uuid,
    /** Affectation, retour, ou recalcul quotidien (les jours d'usage avancent). */
    action: z.enum(['assigned', 'returned', 'recomputed']).default('recomputed'),
    /** Jour de calcul du recalcul quotidien (sinon le jour de l'événement). */
    asOf: z.iso.date().optional(),
  }),
  /** Entretien ou contrôle bientôt dû ou en retard (une alerte par état). */
  'equipment.maintenance_due.v1': z.object({
    maintenanceId: Uuid,
    equipmentId: Uuid,
    state: z.enum(['due_soon', 'overdue']),
  }),
  /** Facture ou note de crédit émise (numéro définitif) : envoi Peppol ou e-mail, timeline. */
  'invoice.issued.v1': z.object({
    invoiceId: Uuid,
    projectId: Uuid.nullable(),
    type: z.string(),
    number: z.string(),
  }),
  /** Statut d'acheminement mis à jour (Peppol livré, e-mail en échec…). */
  'invoice.delivery_updated.v1': z.object({
    invoiceId: Uuid,
    status: z.enum(['queued', 'sent', 'delivered', 'failed']),
    message: z.string().nullable(),
  }),
  /** Relance due selon le calendrier (05 §6) : une étape à la fois. */
  'invoice.reminder_due.v1': z.object({ invoiceId: Uuid, step: z.number().int() }),
  'payment.received.v1': z.object({
    paymentId: Uuid,
    invoiceId: Uuid,
    amount: z.string(),
    source: z.enum(['manual', 'payment_link']),
  }),
  'progress_statement.submitted.v1': z.object({ statementId: Uuid, projectId: Uuid }),
  'progress_statement.approved.v1': z.object({
    statementId: Uuid,
    projectId: Uuid,
    byClient: z.boolean(),
  }),
  'progress_statement.disputed.v1': z.object({ statementId: Uuid, projectId: Uuid, reason: z.string() }),
  /** Nouvelle tentative de transmission ONSS (Check In and Out) des pointages en échec. */
  'attendance.retry_requested.v1': z.object({ projectId: Uuid, timeEntryIds: z.array(Uuid) }),
} as const;

export type EventType = keyof typeof EventPayloads;
export type EventPayload<T extends EventType> = z.infer<(typeof EventPayloads)[T]>;

export const EVENT_TYPES = Object.keys(EventPayloads) as EventType[];

export function parseEventPayload<T extends EventType>(type: T, payload: unknown): EventPayload<T> {
  return EventPayloads[type].parse(payload) as EventPayload<T>;
}

export function isKnownEventType(type: string): type is EventType {
  return type in EventPayloads;
}
