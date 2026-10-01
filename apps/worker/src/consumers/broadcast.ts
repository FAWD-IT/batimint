import { tenantChannel } from '@batimint/contracts';
import type { Consumer } from '../consumer';

const TOPICS: Record<string, string> = {
  'customer.created.v1': 'customers',
  'opportunity.created.v1': 'opportunities',
  'opportunity.stage_changed.v1': 'opportunities',
  'attachment.added.v1': 'attachments',
  'library.imported.v1': 'items',
  'tenant.updated.v1': 'company',
  'integration.updated.v1': 'integrations',
};

/** Diffusion temps réel générique : les écrans ouverts du tenant rafraîchissent la liste concernée. */
export const realtimeBroadcast: Consumer = {
  name: 'realtime-broadcast',
  events: Object.keys(TOPICS) as Consumer['events'],
  async handle({ event, publish }) {
    const topic = TOPICS[event.type];
    if (topic) await publish({ channel: tenantChannel(event.tenantId), topic, ref: event.aggregateId });
  },
};
