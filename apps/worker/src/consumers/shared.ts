/** Aides partagées par les consommateurs : destinataires « bureau », notifications in-app, dates. */
import { userChannel } from '@batimint/contracts';
import type { Tx } from '@batimint/db';
import type { ConsumerContext } from '../consumer';

export const dateFr = (d: Date) =>
  d.toLocaleDateString('fr-BE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Brussels',
  });

export async function office(tx: Tx, tenantId: string, roles: string[] = ['owner', 'admin', 'office']) {
  return tx.membership.findMany({ where: { tenantId, status: 'active', role: { in: roles as never[] } } });
}

export async function notify(
  ctx: ConsumerContext,
  userIds: string[],
  n: { type: string; title: string; body?: string; link: string },
): Promise<void> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  await ctx.tx.notification.createMany({
    data: ids.map((userId) => ({
      tenantId: ctx.event.tenantId,
      userId,
      type: n.type,
      title: n.title,
      body: n.body ?? null,
      link: n.link,
      eventId: ctx.event.id,
    })),
    skipDuplicates: true,
  });
  for (const id of ids)
    await ctx.publish({ channel: userChannel(id), topic: 'notifications', data: { title: n.title } });
}
