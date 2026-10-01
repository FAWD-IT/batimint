import { inboxChannel, parseEventPayload, tenantChannel, userChannel } from '@batimint/contracts';
import { customerDisplayName, findDuplicates } from '@batimint/domain';
import type { Consumer } from '../consumer';

const SOURCE_LABELS: Record<string, string> = {
  web_form: 'formulaire web',
  email: 'e-mail',
  manual: 'saisie',
  phone: 'téléphone',
};

/**
 * lead.received (02 P2.1) → fiche prospect (ou client existant retrouvé), adresse de chantier,
 * opportunité « nouvelle », notification au bureau. Idempotent par événement.
 */
export const leadIntake: Consumer = {
  name: 'lead-intake',
  events: ['lead.received.v1'],
  async handle({ tx, event, publish }) {
    const { leadId } = parseEventPayload('lead.received.v1', event.payload);
    const lead = await tx.lead.findUnique({ where: { id: leadId } });
    if (!lead || lead.status !== 'new') return;
    const candidates = await tx.customer.findMany({
      where: {
        archivedAt: null,
        mergedIntoId: null,
        OR: [
          ...(lead.email ? [{ email: lead.email }] : []),
          ...(lead.phone ? [{ phone: { not: null } }] : []),
        ],
      },
      take: 500,
    });
    const dup = findDuplicates({ email: lead.email, phone: lead.phone }, candidates)[0];
    let customerId = dup?.id;
    if (!customerId) {
      const isCompany = Boolean(lead.companyName);
      const [firstName, ...rest] = lead.name.split(/\s+/);
      const c = await tx.customer.create({
        data: {
          tenantId: event.tenantId,
          kind: isCompany ? 'company' : 'individual',
          status: 'prospect',
          firstName: isCompany ? null : rest.length ? (firstName ?? null) : null,
          lastName: isCompany ? null : rest.length ? rest.join(' ') : lead.name,
          companyName: lead.companyName,
          displayName: customerDisplayName({
            kind: isCompany ? 'company' : 'individual',
            firstName: rest.length ? firstName : null,
            lastName: rest.length ? rest.join(' ') : lead.name,
            companyName: lead.companyName,
          }),
          email: lead.email,
          phone: lead.phone,
          street: lead.street,
          postalCode: lead.postalCode,
          city: lead.city,
          source: lead.source,
        },
      });
      customerId = c.id;
    }
    let siteId: string | null = null;
    if (lead.street && lead.postalCode && lead.city) {
      const existingSite = await tx.site.findFirst({
        where: { customerId, street: lead.street, postalCode: lead.postalCode },
      });
      siteId =
        existingSite?.id ??
        (
          await tx.site.create({
            data: {
              tenantId: event.tenantId,
              customerId,
              street: lead.street,
              postalCode: lead.postalCode,
              city: lead.city,
            },
          })
        ).id;
    }
    const customer = await tx.customer.findUniqueOrThrow({ where: { id: customerId } });
    const firstLine = (lead.message ?? '').split('\n').find((l) => l.trim()) ?? '';
    const title = (firstLine.length > 4 ? firstLine : `Demande de ${customer.displayName}`).slice(0, 120);
    const top = await tx.opportunity.findFirst({ where: { stage: 'new' }, orderBy: { position: 'asc' } });
    const opp = await tx.opportunity.create({
      data: {
        tenantId: event.tenantId,
        customerId,
        siteId,
        title,
        description: lead.message,
        stage: 'new',
        position: (top?.position ?? 0) - 1,
      },
    });
    await tx.lead.update({
      where: { id: lead.id },
      data: { status: 'converted', customerId, opportunityId: opp.id },
    });
    const office = await tx.membership.findMany({
      where: { tenantId: event.tenantId, status: 'active', role: { in: ['owner', 'admin', 'office'] } },
    });
    const notifTitle = `Nouvelle demande : ${customer.displayName}`;
    await tx.notification.createMany({
      data: office.map((m) => ({
        tenantId: event.tenantId,
        userId: m.userId,
        type: 'lead.received',
        title: notifTitle,
        body: `Reçue par ${SOURCE_LABELS[lead.source] ?? lead.source}. Fiche prospect et opportunité créées.`,
        link: `/opportunites/${opp.id}`,
        eventId: event.id,
      })),
      skipDuplicates: true,
    });
    for (const m of office)
      await publish({ channel: userChannel(m.userId), topic: 'notifications', data: { title: notifTitle } });
    await publish({ channel: inboxChannel(event.tenantId), topic: 'leads', ref: lead.id });
    await publish({ channel: tenantChannel(event.tenantId), topic: 'opportunities', ref: opp.id });
  },
};
