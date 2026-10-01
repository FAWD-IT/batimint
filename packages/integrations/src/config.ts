/**
 * Sélection des implémentations par variables d'environnement (mock par défaut, règle n°5).
 */
import { MockMailer } from './mail/mock';
import { SmtpMailer } from './mail/smtp';
import type { Mailer } from './mail/types';
import { MemoryStorage } from './storage/memory';
import { S3Storage } from './storage/s3';
import type { ObjectStorage } from './storage/types';
import { MockVatValidator } from './vat/mock';
import type { VatValidator } from './vat/types';
import { ViesVatValidator } from './vat/vies';

type Env = Record<string, string | undefined>;

export interface Integrations {
  mailer: Mailer;
  storage: ObjectStorage;
  vat: VatValidator;
}

export function createMailer(env: Env = process.env): Mailer {
  if ((env['MAIL_PROVIDER'] ?? 'smtp') === 'mock' || !env['SMTP_HOST']) return new MockMailer();
  return new SmtpMailer({
    host: env['SMTP_HOST'],
    port: Number(env['SMTP_PORT'] ?? 587),
    secure: env['SMTP_SECURE'] === 'true',
    user: env['SMTP_USER'] || undefined,
    pass: env['SMTP_PASS'] || undefined,
    from: env['MAIL_FROM'] ?? 'Batimint <no-reply@batimint.local>',
  });
}

export function createStorage(env: Env = process.env): ObjectStorage {
  if (!env['S3_ENDPOINT'] || env['STORAGE_PROVIDER'] === 'memory') return new MemoryStorage();
  return new S3Storage({
    endpoint: env['S3_ENDPOINT'],
    publicEndpoint: env['S3_PUBLIC_ENDPOINT'] || undefined,
    region: env['S3_REGION'] ?? 'eu-west-1',
    accessKeyId: env['S3_ACCESS_KEY'] ?? '',
    secretAccessKey: env['S3_SECRET_KEY'] ?? '',
    forcePathStyle: (env['S3_FORCE_PATH_STYLE'] ?? 'true') === 'true',
    buckets: {
      uploads: env['S3_BUCKET_UPLOADS'] ?? 'batimint-uploads',
      legal: env['S3_BUCKET_LEGAL'] ?? 'batimint-legal',
    },
  });
}

export function createVatValidator(env: Env = process.env): VatValidator {
  return env['VAT_VALIDATOR_PROVIDER'] === 'vies' ? new ViesVatValidator() : new MockVatValidator();
}

export function createIntegrations(env: Env = process.env): Integrations {
  return { mailer: createMailer(env), storage: createStorage(env), vat: createVatValidator(env) };
}
