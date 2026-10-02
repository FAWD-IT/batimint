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
