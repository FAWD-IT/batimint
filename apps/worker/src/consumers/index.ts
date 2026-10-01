import type { Consumer } from '../consumer';
import { sendInvitation } from './invitations';
import { memberJoined } from './members';
import { diagnosticNotification } from './notifications';

export const CONSUMERS: readonly Consumer[] = [diagnosticNotification, sendInvitation, memberJoined];

export function consumersFor(type: string): Consumer[] {
  return CONSUMERS.filter((c) => (c.events as readonly string[]).includes(type));
}
