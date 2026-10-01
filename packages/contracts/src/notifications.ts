import { z } from 'zod';
import { Uuid } from './common';

export const NotificationSchema = z
  .object({
    id: Uuid,
    type: z.string(),
    title: z.string(),
    body: z.string().nullable(),
    link: z.string().nullable(),
    readAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .meta({ id: 'Notification' });
export type NotificationDto = z.infer<typeof NotificationSchema>;

export const NotificationListSchema = z.object({
  items: z.array(NotificationSchema),
  unreadCount: z.number().int(),
});

export const DiagnosticPingRequestSchema = z.object({ message: z.string().trim().min(1).max(200).optional() });
export const DiagnosticPingResponseSchema = z.object({ eventId: Uuid, emittedAt: z.string() });
