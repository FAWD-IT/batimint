import { type EventActor, type Tx, type TxOptions, withTenant, writeAudit } from '@batimint/db';
import type { Action } from '@batimint/domain';
import type { FastifyRequest } from 'fastify';
import type { AppDeps, TenantAuthContext } from '../context';
import { requireTenant } from '../plugins/auth';

export interface TenantScope {
  tx: Tx;
  auth: TenantAuthContext;
  actor: EventActor;
  /** Écrit une entrée d'audit avec les métadonnées de la requête (règle n°7). */
  audit(action: string, entityType: string, entityId: string | null, changes?: unknown): Promise<void>;
}

/** Vérifie la permission puis exécute `fn` dans une transaction RLS du tenant actif. */
export function inTenant<T>(
  deps: AppDeps,
  req: FastifyRequest,
  action: Action | null,
  fn: (scope: TenantScope) => Promise<T>,
  options?: TxOptions,
): Promise<T> {
  const auth = requireTenant(req, action ?? undefined);
  const actor: EventActor = auth.impersonatorId
    ? { type: 'platform_admin', id: auth.impersonatorId, label: auth.name }
    : { type: 'user', id: auth.userId, label: auth.name };
  return withTenant(
    deps.prisma,
    auth.tenantId,
    auth.userId,
    (tx) =>
      fn({
        tx,
        auth,
        actor,
        audit: (actionName, entityType, entityId, changes) =>
          writeAudit(tx, {
            tenantId: auth.tenantId,
            actor,
            action: actionName,
            entityType,
            entityId,
            changes,
            ip: req.ip,
            userAgent: req.headers['user-agent'] ?? null,
            requestId: req.id,
          }),
      }),
    options,
  );
}

export function isoDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}
