export interface MailAttachment {
  filename: string;
  content: Uint8Array | string;
  contentType?: string;
}

export interface MailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  from?: string;
  attachments?: MailAttachment[];
  /** En-têtes de traçabilité (tenant, document). */
  headers?: Record<string, string>;
}

export interface SentMail {
  messageId: string;
}

export interface Mailer {
  readonly provider: string;
  send(message: MailMessage): Promise<SentMail>;
}
