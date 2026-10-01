/**
 * Entreprise, paramètres métier, onboarding et abonnement (03 §1, 02 P1).
 */
import {
  CompanySchema,
  CompanyUpdateSchema,
  OkSchema,
  OnboardingSchema,
  parseTenantSettings,
  PlanUpdateSchema,
  SubscriptionSchema,
  TenantSettingsSchema,
  VatLookupRequestSchema,
  VatLookupResponseSchema,
} from '@batimint/contracts';
import { diffObjects, emitEvent, type Tx } from '@batimint/db';
import {
  billableSeats,
  enabledFeatures,
  type FeatureFlags,
  isValidBic,
  isValidEnterpriseNumber,
  isValidIban,
  normalizeEnterpriseNumber,
  normalizeHex,
  normalizeIban,
  onboardingChecklist,
  type OnboardingStep,
  passesAA,
  trialDaysLeft,
} from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { badRequest, notFound } from '../lib/errors';
import { inTenant, iso } from '../lib/tenant';

const LOGO_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
} as const;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** Étapes de la checklist disponibles avec les modules livrés (la bibliothèque arrive en M2). */
export const ONBOARDING_AVAILABLE: OnboardingStep[] = [
  'company',
  'bank',
  'branding',
  'terms',
  'rates',
  'peppol',
  'team',
];

type TenantRow = Awaited<ReturnType<Tx['tenant']['findUniqueOrThrow']>>;

export function toCompanyDto(t: TenantRow, inboundDomain: string | undefined) {
  return {
    id: t.id,
    name: t.name,
    legalName: t.legalName,
    slug: t.slug,
    legalForm: t.legalForm,
    enterpriseNumber: t.enterpriseNumber,
    vatNumber: t.vatNumber,
    vatValidatedAt: iso(t.vatValidatedAt),
    street: t.street,
    postalCode: t.postalCode,
    city: t.city,
    country: t.country,
    email: t.email,
    phone: t.phone,
    website: t.website,
    iban: t.iban,
    bic: t.bic,
    logoUrl: t.logoKey ? `/api/v1/company/logo?v=${encodeURIComponent(t.logoKey.slice(-12))}` : null,
    brandColor: t.brandColor,
    brandColorAccessible: t.brandColor ? passesAA(t.brandColor) : true,
    termsAndConditions: t.termsAndConditions,
    legalMentions: t.legalMentions,
    documentLocale: t.documentLocale,
    inboundEmail: inboundDomain ? `${t.slug}@${inboundDomain}` : null,
  };
}

const LEGAL_FORMS = /\b(SRL|SPRL|SA|SC|SCRL|SNC|SComm|ASBL|BV|BVBA|NV|CV|VZW)\b/;

export const companyRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const inboundDomain = process.env['INBOUND_EMAIL_DOMAIN'] || undefined;

  app.addContentTypeParser(
    Object.keys(LOGO_TYPES),
    { parseAs: 'buffer', bodyLimit: LOGO_MAX_BYTES },
    (_req, body, done) => done(null, body),
  );

  app.get(
    '/company',
    { schema: { tags: ['entreprise'], summary: 'Fiche entreprise', response: { 200: CompanySchema } } },
    (req) =>
      inTenant(deps, req, 'company.read', async ({ tx, auth }) =>
        toCompanyDto(await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } }), inboundDomain),
      ),
  );

  app.post(
    '/company/vat-lookup',
    {
      schema: {
        tags: ['entreprise'],
        summary: 'Valider un numéro de TVA (VIES) et pré-remplir',
        body: VatLookupRequestSchema,
        response: { 200: VatLookupResponseSchema },
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req) => {
      const n = normalizeEnterpriseNumber(req.body.number);
      if (!n || !isValidEnterpriseNumber(n)) {
        throw badRequest(
          'invalid_enterprise_number',
          "Ce numéro d'entreprise n'est pas valide. Il compte 10 chiffres, par exemple 0123.456.749.",
        );
      }
      const r = await deps.integrations.vat.validate(`BE${n}`);
      const legalForm = r.name?.match(LEGAL_FORMS)?.[1] ?? null;
      return {
        valid: r.valid,
        vatNumber: r.vatNumber,
        enterpriseNumber: n,
        name: r.name,
        legalForm,
        street: r.address?.street ?? null,
        postalCode: r.address?.postalCode ?? null,
        city: r.address?.city ?? null,
        source: r.source,
      };
    },
  );

  app.patch(
    '/company',
    {
      schema: {
        tags: ['entreprise'],
        summary: 'Modifier la fiche entreprise',
        body: CompanyUpdateSchema,
        response: { 200: CompanySchema },
      },
    },
    async (req) => {
      const input = { ...req.body } as Record<string, unknown>;
      let vatCheck: { valid: boolean; source: string } | null = null;
      if (typeof input['enterpriseNumber'] === 'string') {
        const n = normalizeEnterpriseNumber(input['enterpriseNumber']);
        if (!n || !isValidEnterpriseNumber(n)) {
          throw badRequest(
            'invalid_enterprise_number',
            "Ce numéro d'entreprise n'est pas valide. Il compte 10 chiffres, par exemple 0123.456.749.",
          );
        }
        input['enterpriseNumber'] = n;
        input['vatNumber'] = `BE${n}`;
        vatCheck = await deps.integrations.vat.validate(`BE${n}`);
      }
      if (typeof input['iban'] === 'string') {
        if (!isValidIban(input['iban']))
          throw badRequest(
            'invalid_iban',
            "Cet IBAN n'est pas valide. Vérifiez les chiffres (ex. BE68 5390 0754 7034).",
          );
        input['iban'] = normalizeIban(input['iban']);
      }
      if (typeof input['bic'] === 'string') {
        if (!isValidBic(input['bic']))
          throw badRequest('invalid_bic', "Ce code BIC n'est pas valide (8 ou 11 caractères, ex. GEBABEBB).");
        input['bic'] = input['bic'].replace(/\s+/g, '').toUpperCase();
      }
      if (typeof input['brandColor'] === 'string') {
        const hex = normalizeHex(input['brandColor']);
        if (!hex) throw badRequest('invalid_color', 'Couleur invalide : utilisez le format #RRGGBB.');
        input['brandColor'] = hex;
      }
      return inTenant(deps, req, 'company.update', async ({ tx, auth, actor, audit }) => {
        const before = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } });
        if (vatCheck && input['enterpriseNumber'] !== before.enterpriseNumber) {
          input['vatValidatedAt'] = vatCheck.valid ? new Date() : null;
        } else if (vatCheck?.valid && !before.vatValidatedAt) {
          input['vatValidatedAt'] = new Date();
        }
        const after = await tx.tenant.update({ where: { id: auth.tenantId }, data: input });
        const changes = diffObjects(
          before as unknown as Record<string, unknown>,
          after as unknown as Record<string, unknown>,
        );
        delete changes['updatedAt'];
        if (Object.keys(changes).length > 0) {
          await audit('company.updated', 'tenant', auth.tenantId, changes);
          await emitEvent(tx, {
            tenantId: auth.tenantId,
            type: 'tenant.updated.v1',
            aggregateType: 'tenant',
            aggregateId: auth.tenantId,
            payload: { fields: Object.keys(changes) },
            actor,
          });
        }
        return toCompanyDto(after, inboundDomain);
      });
    },
  );

  app.put(
    '/company/logo',
    {
      schema: {
        tags: ['entreprise'],
        summary: 'Envoyer le logo (PNG, JPEG, WebP ou SVG, 2 Mo max)',
        consumes: Object.keys(LOGO_TYPES),
        response: { 200: CompanySchema },
      },
    },
    async (req) => {
      const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim() as keyof typeof LOGO_TYPES;
      const body = req.body as Buffer | undefined;
      if (!LOGO_TYPES[type] || !Buffer.isBuffer(body) || body.length === 0) {
        throw badRequest(
          'invalid_logo',
          'Format non pris en charge : envoyez une image PNG, JPEG, WebP ou SVG de moins de 2 Mo.',
        );
      }
      return inTenant(deps, req, 'company.update', async ({ tx, auth, audit }) => {
        const key = `tenants/${auth.tenantId}/logo-${uuidv7()}.${LOGO_TYPES[type]}`;
        await deps.integrations.storage.put({ bucket: 'uploads', key, body, contentType: type });
        const after = await tx.tenant.update({ where: { id: auth.tenantId }, data: { logoKey: key } });
        await audit('company.logo_updated', 'tenant', auth.tenantId, { logoKey: key });
        return toCompanyDto(after, inboundDomain);
      });
    },
  );

  app.get(
    '/company/logo',
    { schema: { tags: ['entreprise'], summary: 'Logo de l’entreprise', hide: true } },
    async (req, reply) => {
      const key = await inTenant(
        deps,
        req,
        null,
        async ({ tx, auth }) => (await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } })).logoKey,
      );
      if (!key) throw notFound('Le logo');
      const body = await deps.integrations.storage.get('uploads', key);
      const ext = key.split('.').pop() as string;
      const type = Object.entries(LOGO_TYPES).find(([, e]) => e === ext)?.[0] ?? 'application/octet-stream';
      return reply
        .header('content-type', type)
        .header('cache-control', 'private, max-age=86400')
        .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
        .send(Buffer.from(body));
    },
  );

  app.get(
    '/company/settings',
    {
      schema: { tags: ['entreprise'], summary: 'Paramètres métier', response: { 200: TenantSettingsSchema } },
    },
    (req) =>
      inTenant(deps, req, 'company.read', async ({ tx, auth }) =>
        parseTenantSettings((await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } })).settings),
      ),
  );

  app.put(
    '/company/settings',
    {
      schema: {
        tags: ['entreprise'],
        summary: 'Enregistrer les paramètres métier',
        body: TenantSettingsSchema,
        response: { 200: TenantSettingsSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'settings.update', async ({ tx, auth, audit }) => {
        const keys = req.body.rateProfiles.map((r) => r.key);
        if (new Set(keys).size !== keys.length)
          throw badRequest('duplicate_rate_profile', 'Deux profils horaires portent le même code.');
        const before = parseTenantSettings(
          (await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } })).settings,
        );
        await tx.tenant.update({ where: { id: auth.tenantId }, data: { settings: req.body } });
        const changes = diffObjects(
          before as unknown as Record<string, unknown>,
          req.body as unknown as Record<string, unknown>,
        );
        if (Object.keys(changes).length > 0)
          await audit('settings.updated', 'tenant', auth.tenantId, changes);
        return req.body;
      }),
  );

  app.get(
    '/company/onboarding',
    {
      schema: {
        tags: ['entreprise'],
        summary: "Checklist d'onboarding",
        response: { 200: OnboardingSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'company.read', async ({ tx, auth }) => {
        const t = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } });
        const settings = parseTenantSettings(t.settings);
        const [members, invitations, peppol] = await Promise.all([
          tx.membership.count({ where: { tenantId: auth.tenantId, status: 'active' } }),
          tx.invitation.count({ where: { tenantId: auth.tenantId, acceptedAt: null, revokedAt: null } }),
          tx.integrationConnection.findUnique({
            where: { tenantId_kind: { tenantId: auth.tenantId, kind: 'peppol' } },
          }),
        ]);
        const checklist = onboardingChecklist(
          {
            vatValidated: Boolean(t.vatValidatedAt),
            hasAddress: Boolean(t.street && t.postalCode && t.city),
            hasIban: Boolean(t.iban),
            hasLogo: Boolean(t.logoKey),
            hasTerms: Boolean(t.termsAndConditions),
            hasHourlyRates: settings.rateProfiles.length > 0,
            libraryItemCount: 0,
            peppolStatus: peppol?.status ?? 'not_connected',
            invitedOrMembers: members + invitations,
          },
          ONBOARDING_AVAILABLE,
        );
        return { ...checklist, dismissed: Boolean(t.onboardingCompletedAt) };
      }),
  );

  app.post(
    '/company/onboarding/dismiss',
    { schema: { tags: ['entreprise'], summary: 'Masquer la checklist', response: { 200: OkSchema } } },
    (req) =>
      inTenant(deps, req, 'company.update', async ({ tx, auth }) => {
        await tx.tenant.update({ where: { id: auth.tenantId }, data: { onboardingCompletedAt: new Date() } });
        return { ok: true as const };
      }),
  );

  const subscription = async (tx: Tx, tenantId: string) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const members = await tx.membership.findMany({
      where: { tenantId, status: 'active' },
      select: { role: true },
    });
    return {
      plan: t.plan,
      trialEndsAt: iso(t.trialEndsAt),
      trialDaysLeft: trialDaysLeft(t.trialEndsAt),
      billableSeats: billableSeats(members.map((m) => m.role)),
      totalMembers: members.length,
      features: enabledFeatures(t.plan, t.featureFlags as FeatureFlags),
    };
  };

  app.get(
    '/company/subscription',
    {
      schema: {
        tags: ['entreprise'],
        summary: 'Abonnement et modules',
        response: { 200: SubscriptionSchema },
      },
    },
    (req) => inTenant(deps, req, 'company.read', ({ tx, auth }) => subscription(tx, auth.tenantId)),
  );

  app.put(
    '/company/subscription',
    {
      schema: {
        tags: ['entreprise'],
        summary: 'Changer de plan (encaissement hors scope v1)',
        body: PlanUpdateSchema,
        response: { 200: SubscriptionSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'subscription.manage', async ({ tx, auth, audit }) => {
        const before = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } });
        await tx.tenant.update({ where: { id: auth.tenantId }, data: { plan: req.body.plan } });
        await audit('subscription.plan_changed', 'tenant', auth.tenantId, {
          plan: { from: before.plan, to: req.body.plan },
        });
        return subscription(tx, auth.tenantId);
      }),
  );

  app.get(
    '/audit',
    {
      schema: {
        tags: ['entreprise'],
        summary: "Journal d'audit",
        querystring: z.object({
          entityType: z.string().max(40).optional(),
          entityId: z.string().max(80).optional(),
          before: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
        response: {
          200: z.object({
            items: z.array(
              z.object({
                id: z.string(),
                actorType: z.string(),
                actorLabel: z.string().nullable(),
                action: z.string(),
                entityType: z.string(),
                entityId: z.string().nullable(),
                changes: z.unknown(),
                occurredAt: z.string(),
              }),
            ),
            nextCursor: z.string().nullable(),
          }),
        },
      },
    },
    (req) =>
      inTenant(deps, req, 'audit.read', async ({ tx }) => {
        const q = req.query;
        const rows = await tx.auditLog.findMany({
          where: {
            ...(q.entityType ? { entityType: q.entityType } : {}),
            ...(q.entityId ? { entityId: q.entityId } : {}),
            ...(q.before ? { id: { lt: q.before } } : {}),
          },
          orderBy: { id: 'desc' },
          take: q.limit + 1,
        });
        const page = rows.slice(0, q.limit);
        return {
          items: page.map((r) => ({
            id: r.id,
            actorType: r.actorType,
            actorLabel: r.actorLabel,
            action: r.action,
            entityType: r.entityType,
            entityId: r.entityId,
            changes: r.changes ?? null,
            occurredAt: r.occurredAt.toISOString(),
          })),
          nextCursor: rows.length > q.limit ? (page.at(-1)?.id ?? null) : null,
        };
      }),
  );
};
