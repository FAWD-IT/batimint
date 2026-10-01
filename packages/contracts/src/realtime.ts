/**
 * Messages temps réel (04 « Temps réel ») : légers, ils disent seulement quoi invalider.
 * Canaux : project:{id}, tenant:{id}:inbox, user:{id}, portal:{token}.
 */
import { z } from 'zod';

export const RealtimeMessageSchema = z.object({
  tenantId: z.string(),
  channel: z.string(),
  /** Ce qui a changé (ex. « notifications », « timeline »), pour l'invalidation côté client. */
  topic: z.string(),
  ref: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  at: z.string(),
});
export type RealtimeMessage = z.infer<typeof RealtimeMessageSchema>;

export const REALTIME_PG_CHANNEL = 'realtime';

export function userChannel(userId: string): string {
  return `user:${userId}`;
}
export function tenantChannel(tenantId: string): string {
  return `tenant:${tenantId}`;
}
export function projectChannel(projectId: string): string {
  return `project:${projectId}`;
}
export function inboxChannel(tenantId: string): string {
  return `tenant:${tenantId}:inbox`;
}
export function portalChannel(portalTokenId: string): string {
  return `portal:${portalTokenId}`;
}
