/**
 * Authentification (ADR 0002) : sessions opaques en base (cookie httpOnly ou Bearer pour le mobile),
 * mots de passe scrypt, lien magique, réinitialisation, TOTP optionnel.
 */
import { emitEvent, type PrismaClient, type Tx, withContext, withSystem, writeAudit } from '@batimint/db';
import { permissionsOf, type Role } from '@batimint/domain';
import type { MeResponse, SignupRequest, TenantSummary } from '@batimint/contracts';
import * as OTPAuth from 'otpauth';
import type { AppDeps, AuthContext } from '../context';
import { hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto';
import { AppError, badRequest, conflict, unauthorized } from '../lib/errors';
import { slugify } from '../lib/slug';
import { renderEmail } from './emails';

export const SESSION_TTL_DAYS = 30;
export const SESSION_COOKIE = 'bm_session';
const MAGIC_LINK_TTL_MIN = 20;
const RESET_TTL_MIN = 60;
const TRIAL_DAYS = 14;

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface CreatedSession {
  token: string;
  sessionId: string;
  expiresAt: Date;
}

async function createSession(
  tx: Tx,
  userId: string,
  activeTenantId: string | null,
  meta: RequestMeta,
  impersonatorId: string | null = null,
): Promise<CreatedSession> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000);
  const session = await tx.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      activeTenantId,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 400) ?? null,
      expiresAt,
      impersonatorId,
    },
  });
  return { token, sessionId: session.id, expiresAt };
}

async function uniqueSlug(tx: Tx, base: string): Promise<string> {
  const root = slugify(base);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const exists = await tx.tenant.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
  return `${root}-${randomToken(4).toLowerCase()}`;
}

/** P1.1 — inscription : utilisateur + entreprise + appartenance Owner + session. */
export async function signup(
  deps: AppDeps,
  input: SignupRequest,
  meta: RequestMeta,
): Promise<CreatedSession & { tenantId: string; userId: string }> {
  const passwordHash = await hashPassword(input.password);
  return withSystem(deps.prisma, async (tx) => {
    const existing = await tx.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw conflict(
        'email_taken',
        'Un compte existe déjà avec cette adresse. Connectez-vous, ou utilisez « Mot de passe oublié ».',
      );
    }
    const user = await tx.user.create({ data: { email: input.email, name: input.name, passwordHash } });
    const prefixRow = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM tenants`;
    const tenant = await tx.tenant.create({
      data: {
        name: input.companyName,
        slug: await uniqueSlug(tx, input.companyName),
        enterpriseNumber: input.enterpriseNumber || null,
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86400_000),
        structuredCommPrefix: Number((prefixRow[0]?.n ?? 0n) % 1000n),
        email: input.email,
      },
    });
    await tx.membership.create({
      data: { tenantId: tenant.id, userId: user.id, role: 'owner', createdBy: user.id },
    });
    const actor = { type: 'user' as const, id: user.id, label: user.name };
    await writeAudit(tx, {
      tenantId: tenant.id,
      actor,
      action: 'tenant.created',
      entityType: 'tenant',
      entityId: tenant.id,
      changes: { name: tenant.name },
      ...meta,
    });
    await emitEvent(tx, {
      tenantId: tenant.id,
      type: 'tenant.created.v1',
      aggregateType: 'tenant',
      aggregateId: tenant.id,
      payload: { tenantId: tenant.id, ownerUserId: user.id },
      actor,
    });
    const session = await createSession(tx, user.id, tenant.id, meta);
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return { ...session, tenantId: tenant.id, userId: user.id };
  });
}

async function firstActiveTenantId(tx: Tx, userId: string): Promise<string | null> {
  const m = await tx.membership.findFirst({
    where: { userId, status: 'active' },
    orderBy: { createdAt: 'asc' },
    select: { tenantId: true },
  });
  return m?.tenantId ?? null;
}

function verifyTotp(secretBase32: string, code: string): boolean {
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secretBase32), digits: 6, period: 30 });
  return totp.validate({ token: code, window: 1 }) !== null;
}

export async function login(
  deps: AppDeps,
  input: { email: string; password: string; totp?: string },
  meta: RequestMeta,
): Promise<{ status: 'ok'; session: CreatedSession } | { status: 'mfa_required' }> {
  const user = await withSystem(deps.prisma, (tx) => tx.user.findUnique({ where: { email: input.email } }));
  const ok = await verifyPassword(input.password, user?.passwordHash);
  if (!user || !ok) {
    throw new AppError(
      401,
      'invalid_credentials',
      'E-mail ou mot de passe incorrect. Vérifiez la saisie, ou recevez un lien de connexion par e-mail.',
    );
  }
  if (user.totpEnabledAt && user.totpSecretEnc) {
    if (!input.totp) return { status: 'mfa_required' };
    if (!verifyTotp(deps.cipher.decrypt(user.totpSecretEnc), input.totp)) {
      throw new AppError(
        401,
        'invalid_totp',
        "Code de vérification incorrect. Utilisez le code affiché maintenant dans votre application d'authentification.",
      );
    }
  }
  const session = await withSystem(deps.prisma, async (tx) => {
    const tenantId = await firstActiveTenantId(tx, user.id);
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return createSession(tx, user.id, tenantId, meta);
  });
  return { status: 'ok', session };
}

/** Lien magique : réponse identique que le compte existe ou non (pas d'énumération). */
export async function requestMagicLink(deps: AppDeps, email: string): Promise<void> {
  const token = randomToken();
  const user = await withSystem(deps.prisma, async (tx) => {
    const u = await tx.user.findUnique({ where: { email } });
    if (!u) return null;
    await tx.authToken.create({
      data: {
        purpose: 'magic_link',
        email,
        userId: u.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MIN * 60_000),
      },
    });
    return u;
  });
  if (!user) return;
  const link = `${deps.config.APP_URL}/connexion/lien?token=${encodeURIComponent(token)}`;
  await deps.integrations.mailer.send(
    renderEmail('magicLink', { to: email, name: user.name, link, minutes: MAGIC_LINK_TTL_MIN }),
  );
}

async function consumeAuthToken(tx: Tx, token: string, purpose: 'magic_link' | 'password_reset') {
  const row = await tx.authToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt < new Date() || !row.userId) {
    throw new AppError(
      400,
      'invalid_token',
      purpose === 'magic_link'
        ? 'Ce lien de connexion a expiré ou a déjà servi. Demandez-en un nouveau.'
        : 'Ce lien de réinitialisation a expiré ou a déjà servi. Demandez-en un nouveau.',
    );
  }
  await tx.authToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return row as typeof row & { userId: string };
}

export async function verifyMagicLink(
  deps: AppDeps,
  token: string,
  meta: RequestMeta,
): Promise<CreatedSession> {
  return withSystem(deps.prisma, async (tx) => {
    const row = await consumeAuthToken(tx, token, 'magic_link');
    await tx.user.update({
      where: { id: row.userId },
      data: { emailVerifiedAt: new Date(), lastLoginAt: new Date() },
    });
    return createSession(tx, row.userId, await firstActiveTenantId(tx, row.userId), meta);
  });
}

export async function requestPasswordReset(deps: AppDeps, email: string): Promise<void> {
  const token = randomToken();
  const user = await withSystem(deps.prisma, async (tx) => {
    const u = await tx.user.findUnique({ where: { email } });
    if (!u) return null;
    await tx.authToken.create({
      data: {
        purpose: 'password_reset',
        email,
        userId: u.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + RESET_TTL_MIN * 60_000),
      },
    });
    return u;
  });
  if (!user) return;
  const link = `${deps.config.APP_URL}/mot-de-passe/nouveau?token=${encodeURIComponent(token)}`;
  await deps.integrations.mailer.send(
    renderEmail('passwordReset', { to: email, name: user.name, link, minutes: RESET_TTL_MIN }),
  );
}

/** Réinitialisation : nouveau mot de passe, toutes les sessions existantes sont révoquées. */
export async function resetPassword(
  deps: AppDeps,
  token: string,
  password: string,
  meta: RequestMeta,
): Promise<CreatedSession> {
  const passwordHash = await hashPassword(password);
  return withSystem(deps.prisma, async (tx) => {
    const row = await consumeAuthToken(tx, token, 'password_reset');
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash, emailVerifiedAt: new Date() } });
    await tx.session.updateMany({
      where: { userId: row.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return createSession(tx, row.userId, await firstActiveTenantId(tx, row.userId), meta);
  });
}

/** Résout une session à partir du jeton (cookie ou Bearer). */
export async function resolveSession(
  prisma: PrismaClient,
  token: string,
): Promise<Omit<AuthContext, 'via'> | null> {
  return withSystem(prisma, async (tx) => {
    const session = await tx.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
    let role: Role | null = null;
    let tenantId: string | null = null;
    if (session.impersonatorId && session.activeTenantId) {
      // Impersonation super-admin : lecture seule avec les droits du rôle Comptable (ADR 0002).
      tenantId = session.activeTenantId;
      role = 'accountant';
    } else if (session.activeTenantId) {
      const membership = await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId: session.activeTenantId, userId: session.userId } },
      });
      if (membership && membership.status === 'active') {
        role = membership.role;
        tenantId = membership.tenantId;
      }
    }
    if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
      await tx.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    }
    return {
      sessionId: session.id,
      userId: session.userId,
      email: session.user.email,
      name: session.user.name,
      isPlatformAdmin: session.user.isPlatformAdmin,
      tenantId,
      role,
      impersonatorId: session.impersonatorId,
    };
  });
}

export async function revokeSession(
  prisma: PrismaClient,
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const res = await withContext(prisma, { userId }, (tx) =>
    tx.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  );
  return res.count > 0;
}

export async function listSessions(prisma: PrismaClient, userId: string) {
  return withContext(prisma, { userId }, (tx) =>
    tx.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
    }),
  );
}

export async function switchTenant(prisma: PrismaClient, auth: AuthContext, tenantId: string): Promise<void> {
  await withContext(prisma, { userId: auth.userId }, async (tx) => {
    const m = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId: auth.userId } },
    });
    if (!m || m.status !== 'active')
      throw badRequest('not_a_member', "Vous n'êtes pas membre de cette entreprise.");
    await tx.session.update({ where: { id: auth.sessionId }, data: { activeTenantId: tenantId } });
  });
}

export async function buildMe(deps: AppDeps, auth: AuthContext): Promise<MeResponse> {
  return withContext(deps.prisma, { userId: auth.userId, tenantId: auth.tenantId }, async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: auth.userId } });
    const memberships = await tx.membership.findMany({
      where: { userId: auth.userId, status: 'active' },
      include: { tenant: true },
      orderBy: { createdAt: 'asc' },
    });
    const toSummary = (
      t: { id: string; name: string; slug: string; logoKey: string | null; brandColor: string | null },
      role: Role,
    ): TenantSummary => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      logoUrl: t.logoKey ? `/api/v1/tenant/logo?v=${encodeURIComponent(t.logoKey)}` : null,
      brandColor: t.brandColor,
      role,
    });
    const tenants = memberships.map((m) => toSummary(m.tenant, m.role));
    let current = tenants.find((t) => t.id === auth.tenantId) ?? null;
    if (!current && auth.tenantId && auth.role && auth.impersonatorId) {
      const t = await tx.tenant.findUnique({ where: { id: auth.tenantId } });
      if (t) current = toSummary(t, auth.role);
    }
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        locale: user.locale,
        totpEnabled: Boolean(user.totpEnabledAt),
        isPlatformAdmin: user.isPlatformAdmin,
      },
      tenant: current,
      role: auth.role,
      permissions: auth.role ? permissionsOf(auth.role) : [],
      tenants,
      impersonating: Boolean(auth.impersonatorId),
    };
  });
}

// --- TOTP (2FA optionnel) -------------------------------------------------------

export async function totpSetup(
  deps: AppDeps,
  auth: AuthContext,
): Promise<{ secret: string; otpauthUrl: string }> {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({ issuer: 'Batimint', label: auth.email, secret, digits: 6, period: 30 });
  await withContext(deps.prisma, { userId: auth.userId }, (tx) =>
    tx.user.update({
      where: { id: auth.userId },
      data: { totpSecretEnc: deps.cipher.encrypt(secret.base32), totpEnabledAt: null },
    }),
  );
  return { secret: secret.base32, otpauthUrl: totp.toString() };
}

export async function totpEnable(deps: AppDeps, auth: AuthContext, code: string): Promise<void> {
  await withContext(deps.prisma, { userId: auth.userId }, async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (!user.totpSecretEnc)
      throw badRequest(
        'totp_not_setup',
        "Commencez par scanner le QR code dans votre application d'authentification.",
      );
    if (!verifyTotp(deps.cipher.decrypt(user.totpSecretEnc), code)) {
      throw badRequest('invalid_totp', 'Code incorrect. Vérifiez l’heure de votre téléphone et réessayez.');
    }
    await tx.user.update({ where: { id: auth.userId }, data: { totpEnabledAt: new Date() } });
  });
}

export async function totpDisable(deps: AppDeps, auth: AuthContext, code: string): Promise<void> {
  await withContext(deps.prisma, { userId: auth.userId }, async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (!user.totpSecretEnc || !user.totpEnabledAt) return;
    if (!verifyTotp(deps.cipher.decrypt(user.totpSecretEnc), code)) {
      throw badRequest('invalid_totp', 'Code incorrect. La double authentification reste active.');
    }
    await tx.user.update({ where: { id: auth.userId }, data: { totpEnabledAt: null, totpSecretEnc: null } });
  });
}

export function ensureAuthenticated(auth: AuthContext | null): AuthContext {
  if (!auth) throw unauthorized();
  return auth;
}
