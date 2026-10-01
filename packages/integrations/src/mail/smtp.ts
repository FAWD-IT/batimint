import nodemailer, { type Transporter } from 'nodemailer';
import { IntegrationError } from '../errors';
import type { MailMessage, Mailer, SentMail } from './types';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

export class SmtpMailer implements Mailer {
  readonly provider = 'smtp';
  private readonly transporter: Transporter;

  constructor(private readonly config: SmtpConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.pass ?? '' } : undefined,
    });
  }

  async send(message: MailMessage): Promise<SentMail> {
    try {
      const info = await this.transporter.sendMail({
        from: message.from ?? this.config.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        replyTo: message.replyTo,
        headers: message.headers,
        attachments: message.attachments?.map((a) => ({
          filename: a.filename,
          content: typeof a.content === 'string' ? a.content : Buffer.from(a.content),
          contentType: a.contentType,
        })),
      });
      return { messageId: info.messageId };
    } catch (err) {
      throw new IntegrationError('smtp', "L'e-mail n'a pas pu être envoyé. Le serveur d'envoi ne répond pas.", true, err);
    }
  }
}
