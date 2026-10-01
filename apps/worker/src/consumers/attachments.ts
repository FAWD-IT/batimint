import { parseEventPayload, tenantChannel } from '@batimint/contracts';
import type { Consumer } from '../consumer';

/** attachment.added (note vocale) → transcription rattachée (02 P2.2). Toujours relue par un humain. */
export const transcribeVoiceNote: Consumer = {
  name: 'transcribe-voice-note',
  events: ['attachment.added.v1'],
  async handle({ tx, event, deps, publish }) {
    const p = parseEventPayload('attachment.added.v1', event.payload);
    if (p.kind !== 'voice_note') return;
    const a = await tx.attachment.findUnique({ where: { id: p.attachmentId } });
    if (!a || a.transcript) return;
    try {
      const audio = await deps.integrations.storage.get('uploads', a.storageKey);
      const r = await deps.integrations.ai.transcribe(audio, a.contentType);
      await tx.attachment.update({
        where: { id: a.id },
        data: { transcript: r.text, transcriptStatus: 'done' },
      });
    } catch (err) {
      await tx.attachment.update({ where: { id: a.id }, data: { transcriptStatus: 'failed' } });
      throw err;
    }
    await publish({ channel: tenantChannel(event.tenantId), topic: 'attachments', ref: a.ownerId });
  },
};
