/**
 * Demandes entrantes (02 P2.1, 03 §2) : saisie manuelle, formulaire web embarquable (public),
 * e-mail transféré à l'adresse du tenant (webhook signé). Chaque demande émet `lead.received.v1` :
 * le consommateur crée la fiche prospect et l'opportunité, puis notifie le bureau.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { LeadInputSchema, LeadSchema, OkSchema, PublicLeadSchema } from '@batimint/contracts';
import { emitEvent, type Tx, withSystem, withTenant } from '@batimint/db';
import { leadSpamScore, portalAccent } from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { AppError, notFound } from '../lib/errors';
import { inTenant } from '../lib/tenant';

type LeadRow = Awaited<ReturnType<Tx['lead']['findUniqueOrThrow']>>;
const toLeadDto = (l: LeadRow) => ({
  id: l.id,
  source: l.source,
  status: l.status,
  name: l.name,
  email: l.email,
  phone: l.phone,
  companyName: l.companyName,
  street: l.street,
  postalCode: l.postalCode,
  city: l.city,
  message: l.message,
  customerId: l.customerId,
  opportunityId: l.opportunityId,
  receivedAt: l.receivedAt.toISOString(),
});

async function tenantBySlug(deps: AppDeps, slug: string) {
  const t = await withSystem(deps.prisma, (tx) => tx.tenant.findUnique({ where: { slug } }));
  if (!t) throw notFound('Ce formulaire');
  return t;
}

export const leadRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.get(
    '/leads',
    {
      schema: {
        tags: ['crm'],
        summary: 'Demandes entrantes',
        querystring: z.object({ status: z.enum(['new', 'converted', 'discarded']).optional() }),
        response: { 200: z.object({ items: z.array(LeadSchema) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'leads.read', async ({ tx }) => ({
        items: (
          await tx.lead.findMany({
            where: req.query.status ? { status: req.query.status } : {},
            orderBy: { receivedAt: 'desc' },
            take: 200,
          })
        ).map(toLeadDto),
      })),
  );

  app.post(
    '/leads',
    {
      schema: {
        tags: ['crm'],
        summary: 'Saisir une demande',
        body: LeadInputSchema,
        response: { 201: LeadSchema },
      },
    },
    async (req, reply) => {
      const dto = await inTenant(deps, req, 'leads.write', async ({ tx, auth, actor }) => {
        const lead = await tx.lead.create({
          data: { ...req.body, tenantId: auth.tenantId, createdBy: auth.userId },
        });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'lead.received.v1',
          aggregateType: 'lead',
          aggregateId: lead.id,
          payload: { leadId: lead.id, source: lead.source },
          actor,
        });
        return toLeadDto(lead);
      });
      return reply.status(201).send(dto);
    },
  );

  app.post(
    '/leads/:id/discard',
    {
      schema: {
        tags: ['crm'],
        summary: 'Classer une demande sans suite',
        params: z.object({ id: z.uuid() }),
        response: { 200: OkSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'leads.write', async ({ tx, audit }) => {
        const res = await tx.lead.updateMany({
          where: { id: req.params.id, status: 'new' },
          data: { status: 'discarded' },
        });
        if (!res.count) throw notFound('Cette demande');
        await audit('lead.discarded', 'lead', req.params.id);
        return { ok: true as const };
      }),
  );

  // --- Formulaire web embarquable (public) ---
  app.get(
    '/public/forms/:slug',
    {
      schema: {
        tags: ['public'],
        summary: 'Configuration publique du formulaire de demande',
        params: z.object({ slug: z.string().max(60) }),
        response: {
          200: z.object({ tenantName: z.string(), accent: z.string(), logoUrl: z.string().nullable() }),
        },
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req) => {
      const t = await tenantBySlug(deps, req.params.slug);
      return {
        tenantName: t.name,
        accent: portalAccent(t.brandColor),
        logoUrl: t.logoKey ? `/api/v1/public/tenants/${t.slug}/logo` : null,
      };
    },
  );

  app.get(
    '/public/tenants/:slug/logo',
    { schema: { hide: true, params: z.object({ slug: z.string().max(60) }) } },
    async (req, reply) => {
      const t = await tenantBySlug(deps, req.params.slug);
      if (!t.logoKey) throw notFound('Le logo');
      const body = await deps.integrations.storage.get('uploads', t.logoKey);
      const ext = t.logoKey.split('.').pop();
      const type =
        ext === 'svg'
          ? 'image/svg+xml'
          : ext === 'png'
            ? 'image/png'
            : ext === 'webp'
              ? 'image/webp'
              : 'image/jpeg';
      return reply
        .header('content-type', type)
        .header('cache-control', 'public, max-age=3600')
        .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
        .send(Buffer.from(body));
    },
  );

  app.post(
    '/public/forms/:slug/leads',
    {
      schema: {
        tags: ['public'],
        summary: 'Envoyer une demande via le formulaire web',
        params: z.object({ slug: z.string().max(60) }),
        body: PublicLeadSchema,
        response: { 201: z.object({ ok: z.literal(true) }) },
      },
      config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
    },
    async (req, reply) => {
      const t = await tenantBySlug(deps, req.params.slug);
      const spam = leadSpamScore({
        honeypot: req.body.website,
        message: req.body.message,
        fillMs: req.body.fillMs ?? null,
      });
      await withTenant(deps.prisma, t.id, null, async (tx) => {
        const lead = await tx.lead.create({
          data: {
            tenantId: t.id,
            source: 'web_form',
            status: spam >= 100 ? 'discarded' : 'new',
            name: req.body.name,
            email: req.body.email,
            phone: req.body.phone ?? null,
            street: req.body.street ?? null,
            postalCode: req.body.postalCode ?? null,
            city: req.body.city ?? null,
            message: req.body.message,
            payload: {
              spamScore: spam,
              ip: req.ip,
              userAgent: req.headers['user-agent'] ?? null,
              referer: req.headers.referer ?? null,
            },
          },
        });
        if (spam < 100) {
          await emitEvent(tx, {
            tenantId: t.id,
            type: 'lead.received.v1',
            aggregateType: 'lead',
            aggregateId: lead.id,
            payload: { leadId: lead.id, source: 'web_form' },
            actor: { type: 'portal', label: req.body.name },
          });
        }
      });
      // Réponse identique pour un robot : il n'apprend rien.
      return reply.status(201).send({ ok: true as const });
    },
  );

  // --- E-mail entrant (webhook du fournisseur, signé HMAC-SHA256) ---
  await app.register(async (scoped) => {
    scoped.addContentTypeParser(
      'application/json',
      { parseAs: 'string', bodyLimit: 20 * 1024 * 1024 },
      (_req, body, done) => {
        try {
          done(null, { raw: body as string, json: JSON.parse(body as string) as unknown });
        } catch (err) {
          done(err as Error, undefined);
        }
      },
    );
    scoped.post(
      '/webhooks/inbound-email',
      {
        schema: { tags: ['webhooks'], summary: 'E-mail entrant (demande client ou facture PDF)' },
        config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      },
      async (req, reply) => {
        const { raw, json } = req.body as { raw: string; json: unknown };
        const secret = process.env['INBOUND_EMAIL_WEBHOOK_SECRET'] ?? '';
        const signature = String(req.headers['x-batimint-signature'] ?? '');
        const expected = createHmac('sha256', secret).update(raw).digest('hex');
        if (
          !secret ||
          signature.length !== expected.length ||
          !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
        ) {
          throw new AppError(401, 'invalid_signature', 'Signature du webhook invalide.');
        }
        const mail = z
          .object({
            to: z.string(),
            from: z.object({ email: z.string(), name: z.string().optional() }),
            subject: z.string().default(''),
            text: z.string().default(''),
          })
          .parse(json);
        const slug = mail.to.split('@')[0]?.toLowerCase() ?? '';
        const t = await withSystem(deps.prisma, (tx) => tx.tenant.findUnique({ where: { slug } }));
        if (!t) return reply.status(202).send({ ok: true, ignored: 'unknown_recipient' });
        await withTenant(deps.prisma, t.id, null, async (tx) => {
          const lead = await tx.lead.create({
            data: {
              tenantId: t.id,
              source: 'email',
              name: mail.from.name || mail.from.email,
              email: mail.from.email.toLowerCase(),
              message: [mail.subject, mail.text].filter(Boolean).join('\n\n').slice(0, 5000),
              payload: { subject: mail.subject },
            },
          });
          await emitEvent(tx, {
            tenantId: t.id,
            type: 'lead.received.v1',
            aggregateType: 'lead',
            aggregateId: lead.id,
            payload: { leadId: lead.id, source: 'email' },
            actor: { type: 'webhook', label: 'e-mail entrant' },
          });
        });
        return reply.status(202).send({ ok: true });
      },
    );
  });
};
