/**
 * Planning (03 §6) — effets idempotents :
 *  - temps réel de la grille, du cockpit et du portail (date de début) ;
 *  - date de début annoncée au client (portail, fil, e-mail) une fois stable ;
 *  - planning du lendemain envoyé à 18 h à chaque personne (notification + e-mail, tutoiement).
 */
import { parseEventPayload, projectChannel, projectPortalChannel, tenantChannel } from '@batimint/contracts';
import { createPortalToken, portalUrl } from '@batimint/db';
import { type Half, slotHalfDays } from '@batimint/domain';
import { buildEmail } from '@batimint/integrations';
import type { Consumer } from '../consumer';
import { footerOf, greeting } from './projects';
import { notify } from './shared';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const longDate = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('fr-BE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

export const planningRealtime: Consumer = {
  name: 'planning-realtime',
  events: ['schedule.changed.v1'],
  async handle({ event, publish }) {
    const p = parseEventPayload('schedule.changed.v1', event.payload);
    await publish({ channel: tenantChannel(event.tenantId), topic: 'planning', ref: p.projectId });
    for (const topic of ['planning', 'project'])
      await publish({ channel: projectChannel(p.projectId), topic, ref: p.projectId });
    if (p.startDate) {
      await publish({ channel: tenantChannel(event.tenantId), topic: 'projects', ref: p.projectId });
      await publish({ channel: projectPortalChannel(p.projectId), topic: 'project', ref: p.projectId });
    }
  },
};

export const arrivalNotice: Consumer = {
  name: 'arrival-notice',
  events: ['project.arrival_scheduled.v1'],
  async handle(ctx) {
    const { tx, event, deps } = ctx;
    const p = parseEventPayload('project.arrival_scheduled.v1', event.payload);
    const project = await tx.project.findUnique({
      where: { id: p.projectId },
      include: { tenant: true, customer: true },
    });
    // La date a pu bouger depuis : seule la date en vigueur est annoncée.
    if (!project?.startDate || iso(project.startDate) !== p.startDate || project.status !== 'preparation')
      return;
    const when = longDate(p.startDate);
    await tx.timelineEntry.create({
      data: {
        tenantId: event.tenantId,
        eventId: event.id,
        projectId: project.id,
        customerId: project.customerId,
        type: 'project.start_scheduled',
        title: `Début des travaux prévu le ${when}`,
        body: 'Date annoncée au client sur son espace',
        actorLabel: 'Planning',
        occurredAt: event.occurredAt,
        visibleToClient: true,
      },
    });
    const email = project.customer.email;
    if (email) {
      const { token } = await createPortalToken(tx, {
        tenantId: event.tenantId,
        kind: 'project',
        projectId: project.id,
        customerId: project.customerId,
        email,
      });
      const t = project.tenant;
      await deps.integrations.mailer.send(
        buildEmail({
          to: email,
          subject: `${t.name} — vos travaux commencent le ${when}`,
          title: `Début des travaux le ${when}`,
          paragraphs: [
            await greeting(tx, project.customerId),
            `Bonne nouvelle : l’équipe arrivera chez vous le ${when} pour votre chantier « ${project.name} ».`,
            'Vous suivez l’avancement, les photos et les documents sur votre espace. Nous vous préviendrons si la date devait changer.',
          ],
          cta: { label: 'Suivre mon chantier', href: portalUrl(deps.appUrl, token) },
          footer: footerOf(t),
          ...(t.email ? { replyTo: t.email } : {}),
        }),
      );
    }
    for (const topic of ['timeline', 'project'])
      await ctx.publish({ channel: projectChannel(project.id), topic, ref: project.id });
    await ctx.publish({ channel: projectPortalChannel(project.id), topic: 'project', ref: project.id });
  },
};

export const dayAhead: Consumer = {
  name: 'planning-day-ahead',
  events: ['planning.day_ahead.v1'],
  async handle(ctx) {
    const { tx, event, deps } = ctx;
    const p = parseEventPayload('planning.day_ahead.v1', event.payload);
    const emp = await tx.employee.findUnique({ where: { id: p.employeeId } });
    const user = await tx.user.findUnique({ where: { id: p.userId } });
    if (!emp || !user) return;
    const date = new Date(`${p.day}T00:00:00Z`);
    const slots = await tx.scheduleSlot.findMany({
      where: {
        startDay: { lte: date },
        endDay: { gte: date },
        OR: [{ employeeId: emp.id }, ...(emp.teamId ? [{ teamId: emp.teamId }] : [])],
      },
      include: { project: { include: { site: true } } },
    });
    const lines: string[] = [];
    for (const s of slots) {
      const halves = slotHalfDays({
        startDay: iso(s.startDay),
        startHalf: s.startHalf as Half,
        endDay: iso(s.endDay),
        endHalf: s.endHalf as Half,
      }).filter((h) => h.day === p.day);
      if (!halves.length) continue;
      const when = halves.length === 2 ? 'journée' : halves[0]!.half === 'am' ? 'matin' : 'après-midi';
      const where = s.project.site ? ` — ${s.project.site.street}, ${s.project.site.city}` : '';
      lines.push(`${s.project.name} (${when})${where}`);
    }
    if (!lines.length) return;
    const title = `Demain, ${longDate(p.day)} : ${lines[0]!.split(' (')[0]}${lines.length > 1 ? ` + ${lines.length - 1}` : ''}`;
    await notify(ctx, [user.id], {
      type: 'planning.day_ahead',
      title,
      body: lines.join(' · '),
      link: '/terrain/planning',
    });
    await deps.integrations.mailer.send(
      buildEmail({
        to: user.email,
        subject: `Ton planning de demain (${longDate(p.day)})`,
        title: 'Ton planning de demain',
        paragraphs: [`Salut ${emp.firstName},`, ...lines, 'Bonne soirée et à demain !'],
        cta: { label: 'Ouvrir mon planning', href: `${deps.appUrl.replace(/\/$/, '')}/terrain/planning` },
        footer: 'Batimint',
      }),
    );
  },
};
