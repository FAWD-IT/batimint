/**
 * CRM (03 §2) : clients et prospects, contacts, adresses de chantier, dédoublonnage et fusion,
 * historique unifié.
 */
import {
  ContactInputSchema,
  ContactSchema,
  CustomerInputSchema,
  CustomerSchema,
  OkSchema,
  SiteInputSchema,
  SiteSchema,
  TimelineItemSchema,
} from '@batimint/contracts';
import { emitEvent, type Tx } from '@batimint/db';
import {
  belgianPeppolId,
  customerDisplayName,
  findDuplicates,
  isValidEnterpriseNumber,
  normalizeEnterpriseNumber,
} from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { badRequest, conflict, notFound } from '../lib/errors';
import { inTenant } from '../lib/tenant';

type CustomerRow = Awaited<ReturnType<Tx['customer']['findUniqueOrThrow']>>;

export function toCustomerDto(c: CustomerRow) {
  return {
    id: c.id,
    kind: c.kind,
    status: c.status,
    displayName: c.displayName,
    firstName: c.firstName,
    lastName: c.lastName,
    companyName: c.companyName,
    legalForm: c.legalForm,
    enterpriseNumber: c.enterpriseNumber,
    vatNumber: c.vatNumber,
    vatLiable: c.vatLiable,
    peppolId: c.peppolId,
    peppolReachable: c.peppolReachable,
    email: c.email,
    phone: c.phone,
    street: c.street,
    postalCode: c.postalCode,
    city: c.city,
    country: c.country,
    notes: c.notes,
    tags: c.tags,
    source: c.source,
    paymentTermsDays: c.paymentTermsDays,
    createdAt: c.createdAt.toISOString(),
  };
}

const toSiteDto = (s: Awaited<ReturnType<Tx['site']['findUniqueOrThrow']>>) => ({
  id: s.id,
  customerId: s.customerId,
  label: s.label,
  street: s.street,
  postalCode: s.postalCode,
  city: s.city,
  country: s.country,
  isPrivateDwelling: s.isPrivateDwelling,
  firstOccupancyYear: s.firstOccupancyYear,
  accessNotes: s.accessNotes,
});

const toContactDto = (c: Awaited<ReturnType<Tx['contact']['findUniqueOrThrow']>>) => ({
  id: c.id,
  customerId: c.customerId,
  firstName: c.firstName,
  lastName: c.lastName,
  jobTitle: c.jobTitle,
  email: c.email,
  phone: c.phone,
  isPrimary: c.isPrimary,
});

/** Données d'un client : nom affiché, numéros normalisés, identifiant Peppol belge. */
export function customerData(input: z.infer<typeof CustomerInputSchema>) {
  const data: Record<string, unknown> = { ...input };
  delete data['force'];
  delete data['id'];
  if (input.kind === 'company' && input.enterpriseNumber) {
    const n = normalizeEnterpriseNumber(input.enterpriseNumber);
    if (!n || !isValidEnterpriseNumber(n)) {
      throw badRequest(
        'invalid_enterprise_number',
        "Ce numéro d'entreprise n'est pas valide (10 chiffres, ex. 0417.497.106).",
      );
    }
    data['enterpriseNumber'] = n;
    data['vatNumber'] = `BE${n}`;
    const peppol = belgianPeppolId(n);
    data['peppolId'] = peppol ? `${peppol.scheme}:${peppol.id}` : null;
  } else if (input.kind === 'individual') {
    data['enterpriseNumber'] = null;
    data['vatNumber'] = null;
    data['peppolId'] = null;
    data['vatLiable'] = false;
  }
  if (typeof input.email === 'string') data['email'] = input.email.toLowerCase();
  const displayName = customerDisplayName({
    kind: input.kind,
    firstName: input.firstName,
    lastName: input.lastName,
    companyName: input.companyName,
  });
  if (!displayName)
    throw badRequest(
      'name_required',
      input.kind === 'company' ? "Indiquez le nom de l'entreprise." : 'Indiquez au moins le nom du client.',
    );
  data['displayName'] = displayName;
  return data;
}

export async function searchCustomerIds(tx: Tx, q: string, limit: number): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM customers
    WHERE archived_at IS NULL AND merged_into_id IS NULL
      AND (rls.search_text(display_name, coalesce(email, ''), coalesce(vat_number, ''), coalesce(city, '')) LIKE '%' || rls.search_text(${q}) || '%'
           OR word_similarity(rls.search_text(${q}), rls.search_text(display_name, coalesce(email, ''), coalesce(vat_number, ''), coalesce(city, ''))) > 0.45)
    ORDER BY word_similarity(rls.search_text(${q}), rls.search_text(display_name, coalesce(email, ''), coalesce(city, ''))) DESC, display_name
    LIMIT ${limit}`;
  return rows.map((r) => r.id);
}

export const crmRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.get(
    '/customers',
    {
      schema: {
        tags: ['crm'],
        summary: 'Clients et prospects',
        querystring: z.object({
          q: z.string().max(100).optional(),
          status: z.enum(['prospect', 'customer']).optional(),
          kind: z.enum(['individual', 'company']).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(100),
        }),
        response: { 200: z.object({ items: z.array(CustomerSchema), total: z.number().int() }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'customers.read', async ({ tx }) => {
        const { q, status, kind, limit } = req.query;
        const where = {
          archivedAt: null,
          mergedIntoId: null,
          ...(status ? { status } : {}),
          ...(kind ? { kind } : {}),
        };
        if (q?.trim()) {
          const ids = await searchCustomerIds(tx, q.trim(), limit);
          const rows = await tx.customer.findMany({ where: { ...where, id: { in: ids } } });
          const order = new Map(ids.map((id, i) => [id, i]));
          rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
          return { items: rows.map(toCustomerDto), total: rows.length };
        }
        const [rows, total] = await Promise.all([
          tx.customer.findMany({ where, orderBy: { updatedAt: 'desc' }, take: limit }),
          tx.customer.count({ where }),
        ]);
        return { items: rows.map(toCustomerDto), total };
      }),
  );

  app.get(
    '/customers/:id',
    {
      schema: {
        tags: ['crm'],
        summary: 'Fiche client',
        params: z.object({ id: z.uuid() }),
        response: {
          200: z.object({
            customer: CustomerSchema,
            contacts: z.array(ContactSchema),
            sites: z.array(SiteSchema),
          }),
        },
      },
    },
    (req) =>
      inTenant(deps, req, 'customers.read', async ({ tx }) => {
        const c = await tx.customer.findUnique({
          where: { id: req.params.id },
          include: { contacts: { orderBy: { createdAt: 'asc' } }, sites: { where: { archivedAt: null } } },
        });
        if (!c) throw notFound('Ce client');
        return {
          customer: toCustomerDto(c),
          contacts: c.contacts.map(toContactDto),
          sites: c.sites.map(toSiteDto),
        };
      }),
  );

  app.post(
    '/customers',
    {
      schema: {
        tags: ['crm'],
        summary: 'Créer un client ou prospect (doublons signalés)',
        body: CustomerInputSchema,
        response: { 201: CustomerSchema },
      },
    },
    async (req, reply) => {
      const dto = await inTenant(deps, req, 'customers.write', async ({ tx, auth, actor, audit }) => {
        const data = customerData(req.body);
        if (!req.body.force) {
          const candidates = await tx.customer.findMany({
            where: {
              archivedAt: null,
              mergedIntoId: null,
              OR: [
                ...(data['email'] ? [{ email: data['email'] as string }] : []),
                ...(data['vatNumber'] ? [{ vatNumber: data['vatNumber'] as string }] : []),
                ...(data['phone'] ? [{ phone: { not: null } }] : []),
              ],
            },
            take: 500,
          });
          const dups = findDuplicates(
            {
              email: data['email'] as string | null,
              vatNumber: data['vatNumber'] as string | null,
              phone: data['phone'] as string | null,
            },
            candidates,
          );
          if (dups.length) {
            const byId = new Map(candidates.map((c) => [c.id, c]));
            throw conflict(
              'possible_duplicate',
              'Un client semblable existe déjà. Ouvrez-le, ou confirmez la création.',
              dups.map((d) => ({ id: d.id, reason: d.reason, displayName: byId.get(d.id)?.displayName })),
            );
          }
        }
        const c = await tx.customer.create({
          data: {
            ...(data as object),
            ...(req.body.id ? { id: req.body.id } : {}),
            tenantId: auth.tenantId,
            createdBy: auth.userId,
          } as never,
        });
        await audit('customer.created', 'customer', c.id, { displayName: c.displayName });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'customer.created.v1',
          aggregateType: 'customer',
          aggregateId: c.id,
          payload: { customerId: c.id, kind: c.kind },
          actor,
        });
        return toCustomerDto(c);
      });
      return reply.status(201).send(dto);
    },
  );

  app.put(
    '/customers/:id',
    {
      schema: {
        tags: ['crm'],
        summary: 'Modifier un client',
        params: z.object({ id: z.uuid() }),
        body: CustomerInputSchema,
        response: { 200: CustomerSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'customers.write', async ({ tx, audit }) => {
        const before = await tx.customer.findUnique({ where: { id: req.params.id } });
        if (!before) throw notFound('Ce client');
        const data = customerData(req.body);
        if (data['peppolId'] !== before.peppolId) {
          data['peppolReachable'] = null;
          data['peppolCheckedAt'] = null;
        }
        const c = await tx.customer.update({ where: { id: before.id }, data });
        await audit('customer.updated', 'customer', c.id, { fields: Object.keys(data) });
        return toCustomerDto(c);
      }),
  );

  app.post(
    '/customers/:id/peppol-check',
    {
      schema: {
        tags: ['crm'],
        summary: "Vérifier dans l'annuaire Peppol si le client est joignable",
        params: z.object({ id: z.uuid() }),
        response: { 200: CustomerSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'customers.write', async ({ tx }) => {
        const c = await tx.customer.findUnique({ where: { id: req.params.id } });
        if (!c) throw notFound('Ce client');
        if (!c.peppolId)
          throw badRequest(
            'no_peppol_id',
            "Ce client n'a pas de numéro d'entreprise : il recevra ses factures par e-mail.",
          );
        const [scheme, id] = c.peppolId.split(':') as [string, string];
        const r = await deps.integrations.peppol.lookupParticipant(scheme, id);
        const updated = await tx.customer.update({
          where: { id: c.id },
          data: { peppolReachable: r.reachable, peppolCheckedAt: new Date() },
        });
        return toCustomerDto(updated);
      }),
  );

  app.post(
    '/customers/:id/merge',
    {
      schema: {
        tags: ['crm'],
        summary: 'Fusionner ce client dans un autre (contacts, adresses, opportunités et demandes déplacés)',
        params: z.object({ id: z.uuid() }),
        body: z.object({ intoId: z.uuid() }),
        response: { 200: CustomerSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'customers.write', async ({ tx, audit }) => {
        if (req.params.id === req.body.intoId)
          throw badRequest('same_customer', 'Choisissez un autre client.');
        const [from, into] = await Promise.all([
          tx.customer.findUnique({ where: { id: req.params.id } }),
          tx.customer.findUnique({ where: { id: req.body.intoId } }),
        ]);
        if (!from || !into) throw notFound('Ce client');
        await tx.contact.updateMany({
          where: { customerId: from.id },
          data: { customerId: into.id, isPrimary: false },
        });
        await tx.site.updateMany({ where: { customerId: from.id }, data: { customerId: into.id } });
        await tx.opportunity.updateMany({ where: { customerId: from.id }, data: { customerId: into.id } });
        await tx.lead.updateMany({ where: { customerId: from.id }, data: { customerId: into.id } });
        await tx.customer.update({
          where: { id: from.id },
          data: { mergedIntoId: into.id, archivedAt: new Date() },
        });
        const merged = await tx.customer.update({
          where: { id: into.id },
          data: {
            email: into.email ?? from.email,
            phone: into.phone ?? from.phone,
            notes: [into.notes, from.notes].filter(Boolean).join('\n\n') || null,
            tags: [...new Set([...into.tags, ...from.tags])],
            status: into.status === 'customer' || from.status === 'customer' ? 'customer' : 'prospect',
          },
        });
        await audit('customer.merged', 'customer', into.id, {
          mergedFrom: from.id,
          mergedName: from.displayName,
        });
        return toCustomerDto(merged);
      }),
  );

  app.delete(
    '/customers/:id',
    {
      schema: {
        tags: ['crm'],
        summary: 'Archiver un client',
        params: z.object({ id: z.uuid() }),
        response: { 200: OkSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'customers.write', async ({ tx, audit }) => {
        const res = await tx.customer.updateMany({
          where: { id: req.params.id, archivedAt: null },
          data: { archivedAt: new Date() },
        });
        if (!res.count) throw notFound('Ce client');
        await audit('customer.archived', 'customer', req.params.id);
        return { ok: true as const };
      }),
  );

  // --- Contacts ---
  app.post(
    '/customers/:id/contacts',
    {
      schema: {
        tags: ['crm'],
        summary: 'Ajouter un contact',
        params: z.object({ id: z.uuid() }),
        body: ContactInputSchema,
        response: { 201: ContactSchema },
      },
    },
    async (req, reply) => {
      const dto = await inTenant(deps, req, 'customers.write', async ({ tx, auth }) => {
        if (!(await tx.customer.findUnique({ where: { id: req.params.id } }))) throw notFound('Ce client');
        if (req.body.isPrimary)
          await tx.contact.updateMany({ where: { customerId: req.params.id }, data: { isPrimary: false } });
        const c = await tx.contact.create({
          data: { ...req.body, tenantId: auth.tenantId, customerId: req.params.id, createdBy: auth.userId },
        });
        return toContactDto(c);
      });
      return reply.status(201).send(dto);
    },
  );

  app.put(
    '/contacts/:id',
    {
      schema: {
        tags: ['crm'],
        summary: 'Modifier un contact',
        params: z.object({ id: z.uuid() }),
        body: ContactInputSchema,
        response: { 200: ContactSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'customers.write', async ({ tx }) => {
        const before = await tx.contact.findUnique({ where: { id: req.params.id } });
        if (!before) throw notFound('Ce contact');
        if (req.body.isPrimary)
          await tx.contact.updateMany({
            where: { customerId: before.customerId },
            data: { isPrimary: false },
          });
        return toContactDto(await tx.contact.update({ where: { id: before.id }, data: req.body }));
      }),
  );

  app.delete(
    '/contacts/:id',
    {
      schema: {
        tags: ['crm'],
        summary: 'Supprimer un contact',
        params: z.object({ id: z.uuid() }),
        response: { 200: OkSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'customers.write', async ({ tx }) => {
        const res = await tx.contact.deleteMany({ where: { id: req.params.id } });
        if (!res.count) throw notFound('Ce contact');
        return { ok: true as const };
      }),
  );

  // --- Adresses de chantier ---
  app.post(
    '/customers/:id/sites',
    {
      schema: {
        tags: ['crm'],
        summary: 'Ajouter une adresse de chantier',
        params: z.object({ id: z.uuid() }),
        body: SiteInputSchema,
        response: { 201: SiteSchema },
      },
    },
    async (req, reply) => {
      const dto = await inTenant(deps, req, 'customers.write', async ({ tx, auth }) => {
        if (!(await tx.customer.findUnique({ where: { id: req.params.id } }))) throw notFound('Ce client');
        const s = await tx.site.create({
          data: { ...req.body, tenantId: auth.tenantId, customerId: req.params.id, createdBy: auth.userId },
        });
        return toSiteDto(s);
      });
      return reply.status(201).send(dto);
    },
  );

  app.put(
    '/sites/:id',
    {
      schema: {
        tags: ['crm'],
        summary: 'Modifier une adresse de chantier',
        params: z.object({ id: z.uuid() }),
        body: SiteInputSchema,
        response: { 200: SiteSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'customers.write', async ({ tx }) => {
        if (!(await tx.site.findUnique({ where: { id: req.params.id } }))) throw notFound('Cette adresse');
        return toSiteDto(await tx.site.update({ where: { id: req.params.id }, data: req.body }));
      }),
  );

  // --- Historique unifié ---
  app.get(
    '/customers/:id/history',
    {
      schema: {
        tags: ['crm'],
        summary: 'Historique du client (demandes, opportunités, visites…)',
        params: z.object({ id: z.uuid() }),
        response: { 200: z.object({ items: z.array(TimelineItemSchema) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'customers.read', async ({ tx }) => {
        const id = req.params.id;
        if (!(await tx.customer.findUnique({ where: { id } }))) throw notFound('Ce client');
        const [leads, opps] = await Promise.all([
          tx.lead.findMany({ where: { customerId: id }, orderBy: { receivedAt: 'desc' } }),
          tx.opportunity.findMany({
            where: { customerId: id },
            include: { visits: true },
            orderBy: { createdAt: 'desc' },
          }),
        ]);
        const items = [
          ...leads.map((l) => ({
            type: 'lead' as const,
            id: l.id,
            title: `Demande reçue (${l.source === 'web_form' ? 'formulaire web' : l.source === 'email' ? 'e-mail' : 'saisie'})`,
            detail: l.message?.slice(0, 200) ?? null,
            at: l.receivedAt.toISOString(),
            href: '/opportunites?vue=demandes',
          })),
          ...opps.map((o) => ({
            type: 'opportunity' as const,
            id: o.id,
            title: o.title,
            detail: null,
            at: o.createdAt.toISOString(),
            href: `/opportunites/${o.id}`,
          })),
          ...opps.flatMap((o) =>
            o.visits.map((v) => ({
              type: 'visit' as const,
              id: v.id,
              title: v.visitedAt ? 'Visite technique réalisée' : 'Visite technique planifiée',
              detail: o.title,
              at: (v.visitedAt ?? v.scheduledAt ?? v.createdAt).toISOString(),
              href: `/opportunites/${o.id}`,
            })),
          ),
        ];
        items.sort((a, b) => b.at.localeCompare(a.at));
        return { items };
      }),
  );
};
