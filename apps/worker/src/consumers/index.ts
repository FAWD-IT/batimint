import type { Consumer } from '../consumer';
import { transcribeVoiceNote } from './attachments';
import { realtimeBroadcast } from './broadcast';
import { sendInvitation } from './invitations';
import { leadIntake } from './leads';
import { memberJoined } from './members';
import { diagnosticNotification } from './notifications';

export const CONSUMERS: readonly Consumer[] = [
  diagnosticNotification,
  sendInvitation,
  memberJoined,
  leadIntake,
  transcribeVoiceNote,
  realtimeBroadcast,
];

export function consumersFor(type: string): Consumer[] {
  return CONSUMERS.filter((c) => (c.events as readonly string[]).includes(type));
}
