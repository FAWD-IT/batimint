/**
 * Liens de portail (client, plus tard sous-traitant) : jeton aléatoire de 32 octets, seule son
 * empreinte SHA-256 est stockée ; le lien en clair n'existe que dans l'e-mail ou la réponse API.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Tx } from './client';

export const PORTAL_LINK_DAYS = 120;

export function hashPortalToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createPortalToken(
  tx: Tx,
  input: {
    tenantId: string;
    kind: 'quote' | 'project';
    quoteId?: string | null;
    projectId?: string | null;
    customerId?: string | null;
    email?: string | null;
    createdBy?: string | null;
    expiresAt?: Date;
  },
): Promise<{ id: string; token: string }> {
  const token = randomBytes(32).toString('base64url');
  const row = await tx.portalToken.create({
    data: {
      tenantId: input.tenantId,
      kind: input.kind,
      quoteId: input.quoteId ?? null,
      projectId: input.projectId ?? null,
      customerId: input.customerId ?? null,
      email: input.email ?? null,
      tokenHash: hashPortalToken(token),
      createdBy: input.createdBy ?? null,
      expiresAt: input.expiresAt ?? new Date(Date.now() + PORTAL_LINK_DAYS * 86_400_000),
    },
  });
  return { id: row.id, token };
}

export function portalUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, '')}/p/${encodeURIComponent(token)}`;
}
