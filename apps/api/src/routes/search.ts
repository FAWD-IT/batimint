/**
 * Recherche globale ⌘K (03 §15) : chantiers, devis, clients, affaires et bibliothèque, filtrés
 * selon les droits du rôle. Les actions rapides sont côté interface.
 */
import { SearchResponseSchema, type SearchResultDto } from '@batimint/contracts';
import { can } from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { inTenant } from '../lib/tenant';

const PER_TYPE = 5;
const ci = (q: string) => ({ contains: q, mode: 'insensitive' as const });

export const searchRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.get(
    '/search',
    {
      schema: {
        tags: ['recherche'],
        summary: 'Recherche multi-objets (⌘K)',
        querystring: z.object({ q: z.string().trim().min(1).max(100) }),
        response: { 200: SearchResponseSchema },
      },
    },
    (req) =>
      inTenant(deps, req, null, async ({ tx, auth }) => {
        const q = req.query.q;
        const items: SearchResultDto[] = [];
        if (can(auth.role, 'projects.read')) {
          const rows = await tx.project.findMany({
            where: {
              OR: [
                { name: ci(q) },
                { number: ci(q) },
                { customer: { displayName: ci(q) } },
                { site: { city: ci(q) } },
              ],
            },
            include: { customer: { select: { displayName: true } }, site: { select: { city: true } } },
            orderBy: { updatedAt: 'desc' },
            take: PER_TYPE,
          });
          for (const p of rows)
            items.push({
              type: 'project',
              id: p.id,
              title: p.name,
              subtitle: [p.number, p.customer.displayName, p.site?.city].filter(Boolean).join(' · '),
              href: `/chantiers/${p.id}`,
            });
        }
        if (can(auth.role, 'quotes.read')) {
          const rows = await tx.quote.findMany({
            where: {
              archivedAt: null,
              isTemplate: false,
              OR: [{ title: ci(q) }, { number: ci(q) }, { customer: { displayName: ci(q) } }],
            },
            include: { customer: { select: { displayName: true } } },
            orderBy: { updatedAt: 'desc' },
            take: PER_TYPE,
          });
          for (const r of rows)
            items.push({
              type: 'quote',
              id: r.id,
              title: r.title,
              subtitle: [r.number, r.customer?.displayName].filter(Boolean).join(' · ') || null,
              href: `/devis/${r.id}`,
            });
        }
        if (can(auth.role, 'customers.read')) {
          const rows = await tx.customer.findMany({
            where: {
              archivedAt: null,
              OR: [{ displayName: ci(q) }, { email: ci(q) }, { phone: ci(q) }, { vatNumber: ci(q) }],
            },
            orderBy: { updatedAt: 'desc' },
            take: PER_TYPE,
          });
          for (const c of rows)
            items.push({
              type: 'customer',
              id: c.id,
              title: c.displayName,
              subtitle: [c.city, c.email].filter(Boolean).join(' · ') || null,
              href: `/clients/${c.id}`,
            });
        }
        if (can(auth.role, 'leads.read')) {
          const rows = await tx.opportunity.findMany({
            where: { OR: [{ title: ci(q) }, { customer: { displayName: ci(q) } }] },
            include: { customer: { select: { displayName: true } } },
            orderBy: { updatedAt: 'desc' },
            take: PER_TYPE,
          });
          for (const o of rows)
            items.push({
              type: 'opportunity',
              id: o.id,
              title: o.title,
              subtitle: o.customer?.displayName ?? null,
              href: `/opportunites/${o.id}`,
            });
        }
        if (can(auth.role, 'library.read')) {
          const rows = await tx.item.findMany({
            where: { archivedAt: null, OR: [{ name: ci(q) }, { code: ci(q) }] },
            orderBy: { name: 'asc' },
            take: PER_TYPE,
          });
          for (const i of rows)
            items.push({
              type: 'item',
              id: i.id,
              title: i.name,
              subtitle: i.code,
              href: `/bibliotheque?article=${i.id}`,
            });
        }
        return { items };
      }),
  );
};
