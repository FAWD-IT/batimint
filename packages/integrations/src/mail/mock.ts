import type { MailMessage, Mailer, SentMail } from './types';

/** Mailer en mémoire : les messages sont conservés pour les tests et la démo. */
export class MockMailer implements Mailer {
  readonly provider = 'mock';
  readonly sent: (MailMessage & { messageId: string; sentAt: Date })[] = [];
  private counter = 0;

  async send(message: MailMessage): Promise<SentMail> {
    const messageId = `mock-${++this.counter}@batimint.local`;
    this.sent.push({ ...message, messageId, sentAt: new Date() });
    return { messageId };
  }

  lastTo(email: string): (MailMessage & { messageId: string }) | undefined {
    return [...this.sent].reverse().find((m) => (Array.isArray(m.to) ? m.to : [m.to]).includes(email));
  }
}
