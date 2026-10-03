import { parseEventPayload, tenantChannel } from '@batimint/contracts';
import type { Consumer } from '../consumer';

/** member.joined → notifier les patrons et administrateurs, rafraîchir la liste des membres. */
export const memberJoined: Consumer = {
  name: 'notify-member-joined',
  events: ['member.joined.v1'],
  async handle({ tx, event, publish }) {
    const payload = parseEventPayload('member.joined.v1', event.payload);
    const user = await tx.user.findUnique({ where: { id: payload.userId } });
    const admins = await tx.membership.findMany({
      where: {
        tenantId: event.tenantId,
        role: { in: ['owner', 'admin'] },
        status: 'active',
        userId: { not: payload.userId },
      },
    });
    await tx.notification.createMany({
      data: admins.map((a) => ({
        tenantId: event.tenantId,
        userId: a.userId,
        type: 'member.joined',
        title: `${user?.name ?? 'Un collaborateur'} a rejoint l'entreprise`,
        link: '/parametres/utilisateurs',
        eventId: event.id,
      })),
      skipDuplicates: true,
    });
    for (const a of admins)
      await publish({
        channel: `user:${a.userId}`,
        topic: 'notifications',
        data: { title: `${user?.name ?? 'Un collaborateur'} a rejoint l'entreprise` },
      });
    await publish({ channel: tenantChannel(event.tenantId), topic: 'members' });
  },
};
