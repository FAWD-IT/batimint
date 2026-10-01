/**
 * Paramètres → Intégrations (07) : état de connexion par type, activation Peppol (P1.5),
 * bouton « Tester la connexion ».
 */
import { IntegrationSchema } from '@batimint/contracts';
import { emitEvent, type Tx } from '@batimint/db';
import { normalizeEnterpriseNumber } from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { badRequest } from '../lib/errors';
import { inTenant, iso } from '../lib/tenant';

const KINDS = ['peppol', 'accounting', 'payments', 'attendance', 'ai', 'inbound_email'] as const;
type Kind = (typeof KINDS)[number];

function providerFor(kind: Kind): string {
  const env: Record<Kind, string | undefined> = {
    peppol: process.env['PEPPOL_PROVIDER'],
    accounting: process.env['ACCOUNTING_PROVIDER'],
    payments: process.env['PAYMENTS_PROVIDER'],
    attendance: process.env['ONSS_PROVIDER'],
    ai: process.env['AI_PROVIDER'],
    inbound_email: process.env['INBOUND_EMAIL_PROVIDER'],
  };
  return env[kind] || 'mock';
}

async function listIntegrations(tx: Tx, tenantId: string) {
  const rows = await tx.integrationConnection.findMany({ where: { tenantId } });
  return KINDS.map((kind) => {
    const row = rows.find((r) => r.kind === kind);
    return {
      kind,
      provider: row?.provider ?? providerFor(kind),
      status: row?.status ?? 'not_connected',
      externalId: row?.externalId ?? null,
      lastCheckedAt: iso(row?.lastCheckedAt),
      lastError: row?.lastError ?? null,
      details: (row?.config as Record<string, unknown> | undefined) ?? {},
    };
  });
}

export const integrationRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.get(
    '/integrations',
    {
      schema: {
        tags: ['intégrations'],
        summary: 'État des intégrations',
        response: { 200: z.object({ items: z.array(IntegrationSchema) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'company.read', async ({ tx, auth }) => ({
        items: await listIntegrations(tx, auth.tenantId),
      })),
  );

  app.post(
    '/integrations/peppol/activate',
    {
      schema: {
        tags: ['intégrations'],
        summary: "Inscrire l'entreprise sur Peppol (entité légale)",
        response: { 200: IntegrationSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'integrations.manage', async ({ tx, auth, actor, audit }) => {
        const t = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } });
        const n = t.enterpriseNumber ? normalizeEnterpriseNumber(t.enterpriseNumber) : null;
        if (!n) {
          throw badRequest(
            'enterprise_number_required',
            "Renseignez d'abord votre numéro d'entreprise (Paramètres → Entreprise).",
          );
        }
        let status: 'pending' | 'active' | 'error' = 'pending';
        let externalId: string | null = null;
        let lastError: string | null = null;
        let config: Record<string, unknown> = {};
        try {
          const entity = await deps.integrations.peppol.registerLegalEntity({
            tenantId: t.id,
            name: t.legalName ?? t.name,
            enterpriseNumber: n,
            vatNumber: t.vatNumber,
            country: t.country,
            email: t.email,
          });
          externalId = entity.id;
          status = entity.status === 'rejected' ? 'error' : entity.status;
          config = {
            participantId: entity.participantId,
            authorizationUrl: entity.authorizationUrl,
            message: entity.message,
          };
        } catch (err) {
          status = 'error';
          lastError = err instanceof Error ? err.message : String(err);
        }
        const row = await tx.integrationConnection.upsert({
          where: { tenantId_kind: { tenantId: auth.tenantId, kind: 'peppol' } },
          update: {
            provider: deps.integrations.peppol.provider,
            status,
            externalId,
            lastError,
            config: config as object,
            lastCheckedAt: new Date(),
          },
          create: {
            tenantId: auth.tenantId,
            kind: 'peppol',
            provider: deps.integrations.peppol.provider,
            status,
            externalId,
            lastError,
            config: config as object,
            lastCheckedAt: new Date(),
          },
        });
        await audit('integration.peppol_activated', 'integration', row.id, { status });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'integration.updated.v1',
          aggregateType: 'integration',
          aggregateId: row.id,
          payload: { kind: 'peppol', status, provider: row.provider },
          actor,
        });
        return (await listIntegrations(tx, auth.tenantId)).find((i) => i.kind === 'peppol')!;
      }),
  );

  app.post(
    '/integrations/:kind/test',
    {
      schema: {
        tags: ['intégrations'],
        summary: 'Tester la connexion',
        params: z.object({ kind: z.enum(KINDS) }),
        response: { 200: IntegrationSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'integrations.manage', async ({ tx, auth, audit }) => {
        const kind = req.params.kind;
        const existing = await tx.integrationConnection.findUnique({
          where: { tenantId_kind: { tenantId: auth.tenantId, kind } },
        });
        let status = existing?.status ?? 'not_connected';
        let lastError: string | null = null;
        let config = (existing?.config as Record<string, unknown> | undefined) ?? {};
        try {
          if (kind === 'peppol') {
            if (!existing?.externalId)
              throw new Error(
                "L'entreprise n'est pas encore inscrite sur Peppol : cliquez sur « Activer Peppol ».",
              );
            const e = await deps.integrations.peppol.getLegalEntityStatus(existing.externalId);
            status = e.status === 'rejected' ? 'error' : e.status;
            config = { ...config, participantId: e.participantId, message: e.message };
          } else if (providerFor(kind) === 'mock') {
            // Les autres intégrations sont simulées tant que leur jalon n'est pas livré : la connexion est saine.
            status = 'active';
          }
        } catch (err) {
          status = 'error';
          lastError = err instanceof Error ? err.message : String(err);
        }
        const row = await tx.integrationConnection.upsert({
          where: { tenantId_kind: { tenantId: auth.tenantId, kind } },
          update: { status, lastError, lastCheckedAt: new Date(), config: config as object },
          create: {
            tenantId: auth.tenantId,
            kind,
            provider: providerFor(kind),
            status,
            lastError,
            lastCheckedAt: new Date(),
            config: config as object,
          },
        });
        await audit('integration.tested', 'integration', row.id, { kind, status, lastError });
        return (await listIntegrations(tx, auth.tenantId)).find((i) => i.kind === kind)!;
      }),
  );
};
