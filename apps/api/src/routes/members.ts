/**
 * Utilisateurs, rôles et invitations (03 §1, 02 P1.6).
 * L'e-mail d'invitation est envoyé par le consommateur de `user.invited.v1` (règle n°3).
 */
import {
  InvitationAcceptSchema,
  InvitationCreateSchema,
  InvitationLookupSchema,
  InvitationSchema,
  LoginResponseSchema,
  MembersResponseSchema,
  MemberUpdateSchema,
  OkSchema,
} from '@batimint/contracts';
import { emitEvent, type Tx, withSystem, writeAudit } from '@batimint/db';
import { assignableRoles, type Role } from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { inTenant, iso } from '../lib/tenant';
import { createSessionForUser, SESSION_COOKIE, sessionCookieSecure } from '../services/auth';

const INVITATION_TTL_DAYS = 14;

type InvitationRow = Awaited<ReturnType<Tx['invitation']['findUniqueOrThrow']>>;

function invitationStatus(i: InvitationRow): 'pending' | 'accepted' | 'revoked' | 'expired' {
  if (i.acceptedAt) return 'accepted';
  if (i.revokedAt) return 'revoked';
  if (i.expiresAt < new Date()) return 'expired';
  return 'pending';
}

function toInvitationDto(i: InvitationRow) {
  return {
    id: i.id,
    email: i.email,
    name: i.name,
    role: i.role,
    status: invitationStatus(i),
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
  };
}

export const memberRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.get(
    '/members',
    {
      schema: {
        tags: ['utilisateurs'],
        summary: 'Membres et invitations',
        response: { 200: MembersResponseSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'members.read', async ({ tx, auth }) => {
        const [members, invitations] = await Promise.all([
          tx.membership.findMany({
            where: { tenantId: auth.tenantId },
            include: { user: true },
            orderBy: { createdAt: 'asc' },
          }),
          tx.invitation.findMany({
            where: { tenantId: auth.tenantId, acceptedAt: null, revokedAt: null },
            orderBy: { createdAt: 'desc' },
          }),
        ]);
        return {
          members: members.map((m) => ({
            id: m.id,
            userId: m.userId,
            name: m.user.name,
            email: m.user.email,
            role: m.role,
            status: m.status,
            lastLoginAt: iso(m.user.lastLoginAt),
            isCurrentUser: m.userId === auth.userId,
          })),
          invitations: invitations.map(toInvitationDto),
        };
      }),
  );

  app.patch(
    '/members/:id',
    {
      schema: {
        tags: ['utilisateurs'],
        summary: "Changer le rôle ou l'accès d'un membre",
        params: z.object({ id: z.uuid() }),
        body: MemberUpdateSchema,
        response: { 200: OkSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'members.manage', async ({ tx, auth, actor, audit }) => {
        const m = await tx.membership.findUnique({ where: { id: req.params.id } });
        if (!m) throw notFound('Ce membre');
        if (m.userId === auth.userId)
          throw badRequest('cannot_modify_self', 'Vous ne pouvez pas modifier votre propre rôle ou accès.');
        if (m.role === 'owner' && auth.role !== 'owner')
          throw forbidden('Seul un patron peut modifier un autre patron.');
        if (req.body.role && !assignableRoles(auth.role).includes(req.body.role))
          throw forbidden('Vous ne pouvez pas attribuer ce rôle.');
        const next = { role: req.body.role ?? m.role, status: req.body.status ?? m.status };
        if (m.role === 'owner' && (next.role !== 'owner' || next.status !== 'active')) {
          const owners = await tx.membership.count({
            where: { tenantId: auth.tenantId, role: 'owner', status: 'active' },
          });
          if (owners <= 1) throw conflict('last_owner', "L'entreprise doit garder au moins un patron actif.");
        }
        await tx.membership.update({ where: { id: m.id }, data: next });
        await audit('member.updated', 'membership', m.id, {
          role: { from: m.role, to: next.role },
          status: { from: m.status, to: next.status },
        });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'member.updated.v1',
          aggregateType: 'membership',
          aggregateId: m.id,
          payload: { membershipId: m.id, role: next.role, status: next.status },
          actor,
        });
        return { ok: true as const };
      }),
  );

  app.post(
    '/invitations',
    {
      schema: {
        tags: ['utilisateurs'],
        summary: 'Inviter un collaborateur',
        body: InvitationCreateSchema,
        response: { 201: InvitationSchema },
      },
    },
    async (req, reply) => {
      const dto = await inTenant(deps, req, 'members.manage', async ({ tx, auth, actor, audit }) => {
        if (!assignableRoles(auth.role).includes(req.body.role))
          throw forbidden('Vous ne pouvez pas attribuer ce rôle.');
        const existingMember = await tx.membership.findFirst({
          where: { tenantId: auth.tenantId, user: { email: req.body.email } },
        });
        if (existingMember)
          throw conflict('already_member', 'Cette personne fait déjà partie de votre entreprise.');
        // Une invitation en attente pour la même adresse est remplacée.
        await tx.invitation.updateMany({
          where: { tenantId: auth.tenantId, email: req.body.email, acceptedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        const invitation = await tx.invitation.create({
          data: {
            tenantId: auth.tenantId,
            email: req.body.email,
            name: req.body.name || null,
            role: req.body.role,
            // Jeton définitif généré par le consommateur au moment de l'envoi : jamais stocké en clair.
            tokenHash: sha256(randomToken()),
            invitedBy: auth.userId,
            createdBy: auth.userId,
            expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000),
          },
        });
        await audit('invitation.created', 'invitation', invitation.id, {
          email: invitation.email,
          role: invitation.role,
        });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'user.invited.v1',
          aggregateType: 'invitation',
          aggregateId: invitation.id,
          payload: {
            invitationId: invitation.id,
            email: invitation.email,
            role: invitation.role,
            invitedBy: auth.userId,
          },
          actor,
        });
        return toInvitationDto(invitation);
      });
      return reply.status(201).send(dto);
    },
  );

  app.post(
    '/invitations/:id/resend',
    {
      schema: {
        tags: ['utilisateurs'],
        summary: "Renvoyer l'invitation",
        params: z.object({ id: z.uuid() }),
        response: { 200: InvitationSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'members.manage', async ({ tx, auth, actor, audit }) => {
        const inv = await tx.invitation.findUnique({ where: { id: req.params.id } });
        if (!inv || inv.acceptedAt || inv.revokedAt) throw notFound('Cette invitation');
        const updated = await tx.invitation.update({
          where: { id: inv.id },
          data: { expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000) },
        });
        await audit('invitation.resent', 'invitation', inv.id);
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'user.invited.v1',
          aggregateType: 'invitation',
          aggregateId: inv.id,
          payload: { invitationId: inv.id, email: inv.email, role: inv.role, invitedBy: auth.userId },
          actor,
        });
        return toInvitationDto(updated);
      }),
  );

  app.delete(
    '/invitations/:id',
    {
      schema: {
        tags: ['utilisateurs'],
        summary: "Annuler l'invitation",
        params: z.object({ id: z.uuid() }),
        response: { 200: OkSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'members.manage', async ({ tx, audit }) => {
        const res = await tx.invitation.updateMany({
          where: { id: req.params.id, acceptedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        if (res.count === 0) throw notFound('Cette invitation');
        await audit('invitation.revoked', 'invitation', req.params.id);
        return { ok: true as const };
      }),
  );

  // --- Acceptation (public, par jeton) ---------------------------------------------------

  const findValidInvitation = async (tx: Tx, token: string) => {
    const inv = await tx.invitation.findUnique({
      where: { tokenHash: sha256(token) },
      include: { tenant: true },
    });
    if (!inv || invitationStatus(inv) !== 'pending') {
      throw new AppError(
        400,
        'invalid_invitation',
        "Cette invitation n'est plus valable (déjà utilisée, annulée ou expirée). Demandez à votre entreprise de vous en renvoyer une.",
      );
    }
    return inv;
  };

  app.get(
    '/invitations/lookup',
    {
      schema: {
        tags: ['utilisateurs'],
        summary: 'Détails d’une invitation (public)',
        querystring: z.object({ token: z.string().min(20).max(200) }),
        response: { 200: InvitationLookupSchema },
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    (req) =>
      withSystem(deps.prisma, async (tx) => {
        const inv = await findValidInvitation(tx, req.query.token);
        const [inviter, account] = await Promise.all([
          inv.invitedBy ? tx.user.findUnique({ where: { id: inv.invitedBy } }) : null,
          tx.user.findUnique({ where: { email: inv.email } }),
        ]);
        return {
          tenantName: inv.tenant.name,
          email: inv.email,
          role: inv.role,
          inviterName: inviter?.name ?? null,
          accountExists: Boolean(account),
        };
      }),
  );

  app.post(
    '/invitations/accept',
    {
      schema: {
        tags: ['utilisateurs'],
        summary: 'Accepter une invitation (public)',
        body: InvitationAcceptSchema,
        response: { 200: LoginResponseSchema },
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const newPasswordHash = req.body.password ? await hashPassword(req.body.password) : null;
      const session = await withSystem(deps.prisma, async (tx) => {
        const inv = await findValidInvitation(tx, req.body.token);
        let user = await tx.user.findUnique({ where: { email: inv.email } });
        if (user) {
          const loggedInAsUser = req.auth?.userId === user.id;
          const passwordOk = req.body.password
            ? await verifyPassword(req.body.password, user.passwordHash)
            : false;
          if (!loggedInAsUser && !passwordOk) {
            throw new AppError(
              401,
              'invalid_credentials',
              'Un compte existe déjà pour cette adresse : saisissez son mot de passe pour rejoindre l’entreprise.',
            );
          }
        } else {
          if (!req.body.name || !newPasswordHash) {
            throw badRequest(
              'name_and_password_required',
              'Indiquez votre nom et choisissez un mot de passe (10 caractères minimum).',
            );
          }
          user = await tx.user.create({
            data: {
              email: inv.email,
              name: req.body.name,
              passwordHash: newPasswordHash,
              emailVerifiedAt: new Date(),
            },
          });
        }
        const membership = await tx.membership.upsert({
          where: { tenantId_userId: { tenantId: inv.tenantId, userId: user.id } },
          update: { role: inv.role, status: 'active' },
          create: {
            tenantId: inv.tenantId,
            userId: user.id,
            role: inv.role as Role,
            createdBy: inv.invitedBy,
          },
        });
        await tx.employee.updateMany({
          where: { tenantId: inv.tenantId, email: inv.email, userId: null },
          data: { userId: user.id },
        });
        await tx.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
        const actor = { type: 'user' as const, id: user.id, label: user.name };
        await writeAudit(tx, {
          tenantId: inv.tenantId,
          actor,
          action: 'invitation.accepted',
          entityType: 'membership',
          entityId: membership.id,
          changes: { role: inv.role },
          ip: req.ip,
          userAgent: req.headers['user-agent'] ?? null,
          requestId: req.id,
        });
        await emitEvent(tx, {
          tenantId: inv.tenantId,
          type: 'member.joined.v1',
          aggregateType: 'membership',
          aggregateId: membership.id,
          payload: { userId: user.id, role: inv.role, invitationId: inv.id },
          actor,
        });
        await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        return createSessionForUser(tx, user.id, inv.tenantId, {
          ip: req.ip,
          userAgent: req.headers['user-agent'] ?? null,
        });
      });
      void reply.setCookie(SESSION_COOKIE, session.token, {
        httpOnly: true,
        secure: sessionCookieSecure(req.protocol, deps.config.isProduction),
        sameSite: 'lax',
        path: '/',
        domain: deps.config.COOKIE_DOMAIN,
        expires: session.expiresAt,
      });
      return { status: 'ok' as const, sessionToken: session.token };
    },
  );
};
