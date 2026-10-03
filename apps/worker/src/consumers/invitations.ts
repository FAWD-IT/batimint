import { randomBytes, createHash } from 'node:crypto';
import { parseEventPayload } from '@batimint/contracts';
import { buildEmail } from '@batimint/integrations';
import type { Consumer } from '../consumer';

const ROLE_LABELS: Record<string, string> = {
  owner: 'Patron',
  admin: 'Administrateur',
  office: 'Bureau',
  site_manager: 'Chef de chantier',
  worker: 'Ouvrier',
  accountant: 'Comptable',
};

/**
 * user.invited → e-mail d'invitation (02 P1.6). Le jeton est généré ici, au moment de l'envoi :
 * seul son empreinte est stockée. Une invitation acceptée ou annulée entre-temps n'est pas envoyée.
 */
export const sendInvitation: Consumer = {
  name: 'send-invitation',
  events: ['user.invited.v1'],
  async handle({ tx, event, deps }) {
    const payload = parseEventPayload('user.invited.v1', event.payload);
    const inv = await tx.invitation.findUnique({
      where: { id: payload.invitationId },
      include: { tenant: true },
    });
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) return;
    const token = randomBytes(32).toString('base64url');
    await tx.invitation.update({
      where: { id: inv.id },
      data: { tokenHash: createHash('sha256').update(token).digest('hex') },
    });
    const inviter = payload.invitedBy ? await tx.user.findUnique({ where: { id: payload.invitedBy } }) : null;
    const link = `${deps.appUrl}/invitation?token=${encodeURIComponent(token)}`;
    const role = ROLE_LABELS[inv.role] ?? inv.role;
    const greeting = inv.name ? `Bonjour ${inv.name},` : 'Bonjour,';
    await deps.integrations.mailer.send(
      buildEmail({
        to: inv.email,
        subject: `${inviter?.name ?? inv.tenant.name} vous invite sur Batimint`,
        title: `Rejoignez ${inv.tenant.name}`,
        paragraphs: [
          greeting,
          `${inviter?.name ?? 'Votre entreprise'} vous invite à rejoindre ${inv.tenant.name} sur Batimint, avec le rôle « ${role} ».`,
          `Ce lien est valable jusqu'au ${inv.expiresAt.toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' })}.`,
        ],
        cta: { label: "Accepter l'invitation", href: link },
        footer: `Invitation envoyée par ${inv.tenant.name} via Batimint.`,
        ...(inviter ? { replyTo: inviter.email } : {}),
      }),
    );
    await tx.notification.createMany({
      data: inviter
        ? [
            {
              tenantId: event.tenantId,
              userId: inviter.id,
              type: 'invitation.sent',
              title: `Invitation envoyée à ${inv.email}`,
              body: `Rôle : ${role}`,
              link: '/parametres/utilisateurs',
              eventId: event.id,
            },
          ]
        : [],
      skipDuplicates: true,
    });
  },
};
