/** Journal d'audit (CLAUDE.md règle n°7) : qui a fait quoi, quand, sur chaque objet légal. */
import type { Tx } from './client';
import { toJsonValue, type EventActor } from './outbox';

export interface AuditEntry {
  tenantId: string;
  actor: EventActor;
  action: string;
  entityType: string;
  entityId?: string | null;
  changes?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export async function writeAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      tenantId: entry.tenantId,
      actorType: entry.actor.type,
      actorId: entry.actor.id ?? null,
      actorLabel: entry.actor.label ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      changes: entry.changes === undefined ? undefined : toJsonValue(entry.changes),
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
      requestId: entry.requestId ?? null,
    },
  });
}

/** Diff superficiel avant/après, limité aux champs modifiés. */
export function diffObjects(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = JSON.stringify(before[key], (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
    const b = JSON.stringify(after[key], (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
    if (a !== b) out[key] = { from: before[key] ?? null, to: after[key] ?? null };
  }
  return out;
}
