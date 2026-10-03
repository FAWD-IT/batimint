/**
 * Contexte de sécurité par transaction (06 « Multi-tenant ») :
 * chaque accès aux données passe par une transaction qui positionne app.tenant_id,
 * app.user_id et, pour les traitements système explicites, app.system.
 */
import type { PrismaClient, Tx } from './client';

export interface DbContext {
  tenantId?: string | null;
  userId?: string | null;
  /** Contournement explicite de l'isolation (relais outbox, authentification, super-admin). */
  system?: boolean;
}

export interface TxOptions {
  timeoutMs?: number;
  /** Attente maximale d'une connexion du pool (rafales sur une ressource verrouillée). */
  maxWaitMs?: number;
  isolationLevel?: 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
}

export async function applyContext(tx: Tx, ctx: DbContext): Promise<void> {
  await tx.$queryRaw`SELECT
    set_config('app.tenant_id', ${ctx.tenantId ?? ''}, true),
    set_config('app.user_id', ${ctx.userId ?? ''}, true),
    set_config('app.system', ${ctx.system ? 'on' : ''}, true)`;
}

export function withContext<T>(
  prisma: PrismaClient,
  ctx: DbContext,
  fn: (tx: Tx) => Promise<T>,
  options: TxOptions = {},
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await applyContext(tx, ctx);
      return fn(tx);
    },
    {
      timeout: options.timeoutMs ?? 20_000,
      maxWait: options.maxWaitMs ?? 10_000,
      ...(options.isolationLevel ? { isolationLevel: options.isolationLevel } : {}),
    },
  );
}

export function withTenant<T>(
  prisma: PrismaClient,
  tenantId: string,
  userId: string | null,
  fn: (tx: Tx) => Promise<T>,
  options?: TxOptions,
): Promise<T> {
  return withContext(prisma, { tenantId, userId }, fn, options);
}

export function withSystem<T>(
  prisma: PrismaClient,
  fn: (tx: Tx) => Promise<T>,
  options?: TxOptions,
): Promise<T> {
  return withContext(prisma, { system: true }, fn, options);
}
