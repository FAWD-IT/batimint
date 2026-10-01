import type { Consumer } from '../consumer';
import { diagnosticNotification } from './notifications';

export const CONSUMERS: readonly Consumer[] = [diagnosticNotification];

export function consumersFor(type: string): Consumer[] {
  return CONSUMERS.filter((c) => (c.events as readonly string[]).includes(type));
}
